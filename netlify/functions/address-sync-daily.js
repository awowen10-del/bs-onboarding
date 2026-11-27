/* The morning run of address-sync-background.js (schedule in netlify.toml), after the TeamUp
   attendance sync has refreshed the member list. A scheduled function only gets 30 seconds. */
exports.handler = async () => {
  const res = await fetch(`${process.env.URL}/.netlify/functions/address-sync-background`, {
    method: 'POST', headers: { 'x-webhook-secret': process.env.WEBHOOK_SECRET }, body: '{}',
  });
  console.log('ADDRESS-SYNC started: ' + res.status);
  return { statusCode: 200 };
};
