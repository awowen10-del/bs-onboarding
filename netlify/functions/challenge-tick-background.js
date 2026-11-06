/* Runs challenge-tick.js with up to 15 minutes, which Netlify gives any function with -background
   at the end of its name. Called by challenge-tick-daily.js.
   POST {"test_guides":"<email>"} adds the guides to that one Trainerize client and sets no tags. */
const { run, testGuides } = require('./challenge-tick');

exports.handler = async (event) => {
  const provided = (event.queryStringParameters && event.queryStringParameters.secret) || event.headers['x-webhook-secret'];
  if (!process.env.WEBHOOK_SECRET || provided !== process.env.WEBHOOK_SECRET) {
    console.log('REJECT: secret');
    return;
  }
  try {
    const { test_guides: email } = JSON.parse(event.body || '{}');
    if (email) console.log('GUIDES TEST ' + JSON.stringify(await testGuides(email)));
    else await run({ dryRun: false });
  } catch (e) {
    console.log('ERROR ' + e.message);
  }
};
