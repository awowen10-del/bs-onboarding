/* The morning run of checkin-brief-background.js (schedule in netlify.toml), after the TeamUp
   attendance sync. A scheduled function only gets 30 seconds, so this hands it over. */
exports.handler = async () => {
  const res = await fetch(`${process.env.URL}/.netlify/functions/checkin-brief-background`, {
    method: 'POST', headers: { 'x-webhook-secret': process.env.WEBHOOK_SECRET }, body: '{}',
  });
  console.log('CHECKIN-BRIEF started: ' + res.status);
  return { statusCode: 200 };
};
