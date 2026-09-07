const express = require('express');
const twilio = require('twilio');
const config = require('../config');
const { parseMessage } = require('../parser');
const { estimateCaloriesForItems } = require('../calorieLookup');
const budgetLogic = require('../budgetLogic');
const calorieLogic = require('../calorieLogic');
const exerciseLogic = require('../exerciseLogic');
const { sendSms } = require('../twilioClient');

const router = express.Router();

function validateTwilioSignature(req) {
  if (!config.twilio.authToken) return true; // not configured yet (local dev)
  const signature = req.headers['x-twilio-signature'];
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const fullUrl = `${proto}://${host}${req.originalUrl}`;
  return twilio.validateRequest(config.twilio.authToken, signature, fullUrl, req.body);
}

function reply(res, message) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message);
  res.type('text/xml').send(twiml.toString());
}

// No message back to whoever texted in — used when the reply has already
// been sent directly to a specific person's own number instead.
function replyEmpty(res) {
  const twiml = new twilio.twiml.MessagingResponse();
  res.type('text/xml').send(twiml.toString());
}

router.post('/', async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return res.status(403).send('Invalid signature');
  }

  const fromNumber = req.body.From;
  const text = (req.body.Body || '').trim();
  const sender = calorieLogic.getPersonByPhone(fromNumber);

  if (!sender) {
    return reply(res, "Sorry, this number isn't registered with the family tracker.");
  }
  if (!text) {
    return reply(res, 'Got an empty message — nothing to log.');
  }

  const knownPeopleNames = calorieLogic.allPeople().map((p) => p.name);
  const bucketNames = budgetLogic
    .allBuckets()
    .filter((b) => !b.is_topline)
    .map((b) => b.name);

  let parsed;
  try {
    parsed = await parseMessage({
      text,
      senderName: sender.name,
      knownPeopleNames,
      bucketNames,
    });
  } catch (err) {
    console.error('[sms] parseMessage failed:', err);
    return reply(res, "Sorry, couldn't process that message right now.");
  }

  const targetPerson = parsed.target_person
    ? calorieLogic.getPersonByName(parsed.target_person) || sender
    : sender;

  try {
    if (parsed.section === 'budget' && parsed.budget) {
      const { bucket_name, description } = parsed.budget;
      const amount = Number(parsed.budget.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return reply(res, "Couldn't find a valid dollar amount in that message.");
      }
      const result = await budgetLogic.applyTransaction({
        bucketName: bucket_name,
        amount,
        description,
        personId: sender.id,
      });
      if (!result.ok) return reply(res, result.error);
      const b = result.bucket;
      const t = result.topline;
      let msg = `Logged $${amount.toFixed(2)} in "${b.name}" (${description || 'no description'}).`;
      if (t) {
        const periodLabel = t.period === 'weekly' ? 'week' : 'month';
        msg += ` ${t.name} remaining: $${t.remaining.toFixed(2)} of $${t.limit.toFixed(2)} this ${periodLabel}.`;
      }
      return reply(res, msg);
    }

    if (parsed.section === 'calories' && parsed.calories) {
      const { direct_amount, food_items, food_items_estimated_calories } = parsed.calories;
      const directAmountNum = direct_amount != null ? Number(direct_amount) : null;
      let calories;
      let note = '';
      if (directAmountNum != null && Number.isFinite(directAmountNum)) {
        calories = directAmountNum;
      } else {
        const { total, breakdown } = await estimateCaloriesForItems(
          food_items || [],
          (food_items_estimated_calories || []).map(Number)
        );
        calories = total;
        note = ' (' + breakdown.map((b) => `${b.item}: ${b.calories}`).join(', ') + ')';
      }
      const status = await calorieLogic.addEntry({
        personId: targetPerson.id,
        calories,
        description: (food_items || []).join(', ') || 'logged calories',
      });
      // Calorie replies go only to the target person's own registered number,
      // regardless of who actually sent the text.
      await sendSms(
        targetPerson.phone,
        `Logged ${calories} cal${note}. Remaining today: ${status.remaining} of ${status.limit}.`
      );
      return replyEmpty(res);
    }

    if (parsed.section === 'exercise' && parsed.exercise) {
      exerciseLogic.addEntry({ personId: targetPerson.id, description: parsed.exercise.description });
      return reply(res, `Logged exercise for ${targetPerson.name}: ${parsed.exercise.description}.`);
    }

    return reply(
      res,
      "Couldn't tell if that was a budget, calorie, or exercise entry — try rephrasing."
    );
  } catch (err) {
    console.error('[sms] Failed to apply parsed message:', err);
    return reply(res, 'Something went wrong logging that — please try again.');
  }
});

module.exports = router;
