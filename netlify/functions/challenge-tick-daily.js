/* The morning run of challenge-tick.js. The schedule is in netlify.toml. */
const { run } = require('./challenge-tick');
exports.handler = async () => {
  await run({ dryRun: false });
  return { statusCode: 200 };
};
