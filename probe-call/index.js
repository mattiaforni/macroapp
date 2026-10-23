// Test 5: opzioni globali + funzione callable + funzione pianificata, senza firebase-admin.
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

setGlobalOptions({ region: "europe-west1", maxInstances: 5, memory: "512MiB" });

export const pingcall = onCall(() => ({ ok: true }));

export const pingschedule = onSchedule({ schedule: "every day 03:00", timeZone: "Europe/Rome" }, async () => {
  console.log("pingschedule ok");
});
