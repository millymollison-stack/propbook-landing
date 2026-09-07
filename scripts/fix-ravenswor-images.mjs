// Fix ravenswor-b1 property images in Supabase
// Run: node scripts/fix-ravenswor-images.mjs

import https from 'https';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0emFncGFkcnFmaWZkaXN4aXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ3MzUyODUsImV4cCI6MjA2MDMxMTI4NX0.uWqc82Hb-qnRq4H9kg5IPykUosm9VvU2s6e8mOalkR0';

const PROP_ID = 'a6603efa-a0e7-451c-83c2-5658a19d78d1';

// Correct scraped images for Vijaya Valley listing 1244244447002591051
// (first image filtered as blocked, remaining are hosting images)
const images = [
  'https://a0.muscache.com/im/pictures/hosting/Hosting-1244244447002591051/original/fa56a093-79db-498c-a6f4-fe6c7162d038.jpeg?im_w=1200',
  'https://a0.muscache.com/im/pictures/hosting/Hosting-1244244447002591051/original/e42c9932-9535-4530-9f2f-eb736bf13761.jpeg?im_w=1200',
];

const hero_image = 'https://a0.muscache.com/im/pictures/hosting/Hosting-1244244447002591051/original/fa56a093-79db-498c-a6f4-fe6c7162d038.jpeg?im_w=1200';

async function patchProperty() {
  const body = JSON.stringify({
    hero_image,
    images,
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'jtzagpbdrqfifdisxipr.supabase.co',
      path: `/rest/v1/properties?id=eq.${PROP_ID}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Prefer': 'return=minimal',
      },
    };

    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Response: ${d}`);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(d);
        else reject(new Error(`HTTP ${res.statusCode}: ${d}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

patchProperty()
  .then(() => console.log('✅ Property images updated'))
  .catch(e => console.error('❌ Error:', e.message));
