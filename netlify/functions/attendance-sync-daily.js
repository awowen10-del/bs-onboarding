/* The morning run of attendance-sync-background.js (schedule in netlify.toml). A scheduled
   function only gets 30 seconds and the first backfill takes minutes, so this hands it over. */
exports.handler = async () => {
  const res = await fetch(`${process.env.URL}/.netlify/functions/attendance-sync-background`, {
    method: 'POST', headers: { 'x-webhook-secret': process.env.WEBHOOK_SECRET }, body: '{}',
  });
  console.log('ATTENDANCE sync started: ' + res.status);
  return { statusCode: 200 };
};
