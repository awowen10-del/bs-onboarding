/* The morning run of challenge-tick.js. The schedule is in netlify.toml. A scheduled function only
   gets 30 seconds and the guides can take longer, so this hands the run to the background one. */
exports.handler = async () => {
  const res = await fetch(`${process.env.URL}/.netlify/functions/challenge-tick-background`, {
    method: 'POST',
    headers: { 'x-webhook-secret': process.env.WEBHOOK_SECRET },
  });
  console.log('TICK started: ' + res.status);
  return { statusCode: 200 };
};
