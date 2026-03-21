const https = require('https');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

// Orphaned treatment IDs to delete
const orphans = [
  '69be3cc9911a8ea261e6742a', // Test extraction
  '69bdde58911a8ea261e673c9', // Snack: [Photo - needs description] at wrong time
  '69bdb449911a8ea261e6730d', // Lunch: [Photo - needs description] duplicate
  '69bdb44a911a8ea261e6730e'  // Lunch: [Photo - needs description] duplicate
];

function deleteTreatment(id) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'DELETE',
      headers: { 'api-secret': NS_SECRET }
    };
    https.request(`${NS_URL}/api/v1/treatments/${id}.json`, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log(`Deleted ${id}: status ${res.statusCode}`);
        resolve(res.statusCode);
      });
    }).on('error', reject).end();
  });
}

async function main() {
  console.log('Deleting orphaned treatments...\n');
  
  for (const id of orphans) {
    try {
      await deleteTreatment(id);
    } catch (e) {
      console.log(`Error deleting ${id}: ${e.message}`);
    }
  }
  
  console.log('\nDone.');
}

main().catch(console.error);
