// Test di isolamento 1: CommonJS, nessun segreto, nessun firebase-admin.
// Se fallisce anche questa, il problema è del progetto/regione, non del nostro codice.
const { onRequest } = require("firebase-functions/v2/https");

exports.pingcjs = onRequest({ region: "europe-west1" }, (req, res) => {
  res.send("ok cjs");
});
