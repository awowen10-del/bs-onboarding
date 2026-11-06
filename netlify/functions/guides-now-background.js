/* Called by the tracker when a coach presses Done on an Intro. Adds that person's Trainerize guides
   straight away. Runs in the background as the three PDFs can take a while. See guidesNow(). */
const { guidesNow } = require('./challenge-tick');

exports.handler = async (event) => {
  try {
    const { id } = JSON.parse(event.body || '{}');
    console.log(`GUIDES ${id}: ` + await guidesNow(id));
  } catch (e) {
    console.log('ERROR ' + e.message);
  }
};
