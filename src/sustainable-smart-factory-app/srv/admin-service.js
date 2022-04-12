const cds = require("@sap/cds");
const request = require("request");
const fs = require("fs");
const {
  maintenanceOrderService,
} = require("@sap/cloud-sdk-vdm-maintenance-order-service");
const { maintenanceOrderApi } = maintenanceOrderService();
const { buildMaintenanceOrderForCreate } = require("./helper");
const sdkDest = { destinationName: "S4HC_D2V" };

const oauth_url =
  "https://iotdev.authentication.eu10.hana.ondemand.com/oauth/token?grant_type=client_credentials";
const sound_inference_url = "/d4e89dce2e1567bc/v1/models/soundmodel:predict";
const cv_inference_url = "/dfccff3697592a4a/v1/models/imagemodel:predict";
const clientid = "sb-a21dc034-456f-4378-a9f3-e9924fdd859f!b11737|aicore!b540";
const clientsecret = "your-password";
const authUser =
  "Basic " + Buffer.from(clientid + ":" + clientsecret).toString("base64");
var token = generateToken(authUser);

module.exports = async function () {
  const db = await cds.connect.to("db");
  const { EquipmentConditions, CVQualityRecords, Anomalies, Equipments } =
    db.entities;

  /** Logic Flow on create a Maintenance Order in S4
   * 1. On specific equipment condition, either list or object page (preferably)
   * Check if conditions are met so to trigger a maintenance order txn.
   * 2. Retrieve EQ ID
   * 3. Create Maintenance Order in S4 with Maintenance Operation Item & Costs
   * 4. Update EquipmentConditions record with the Maintenance Order ID returned from S4 API
   *
   * Note: default-env.json is used for local project connecting to my btp trial landscape.
   * Destination used is pointing to my301832 s4 tenant.
   */
  this.on("createMO", async (req) => {
    //  1. On specific equipment condition, either list or object page (preferably)
    //  Check if conditions are met so to trigger a maintenance order txn.
    //  2. Retrieve EQ ID
    const eqCondEntity = req.params[0];
    const eqCondition = await SELECT.from(
      EquipmentConditions,
      eqCondEntity
    ).columns(["equipment_NR"]);

    //  Retrieve Equipment Entity for fields required on MO Operation
    var equipment = await cds
      .tx(req)
      .run(SELECT.from(Equipments).where({ NR: eqCondition.equipment_NR }));

    //  Date logic: To add 7 days to the MO: Logic implemented in helper as moment object required.

    // console.log(equipment);
    // console.log(equipment[0].name);
    // console.log("data: " + req.data);
    // console.log(eqCondEntity); //  { ID: 1, IsActiveEntity: 'true' }
    // console.log(eqCondition);

    // 3. Create Maintenance Order in S4 with Maintenance Operation Item & Costs
    //  Note: MO Operation logic are implemented in helper file.
    //  Assumptions randomised:
    //  - Priority: random in helper
    //  - Duration: random in helper
    const datamo = {
      OrderType: "YA02",
      Equipment: eqCondition.equipment_NR,
      EquipmentName: equipment[0].name,
      Desc: "Noise detected from " + equipment[0].name,
      OperationDesc: "Fix " + equipment[0].name
    };

    const mo = buildMaintenanceOrderForCreate(datamo);
    // console.log(mo);
    const result = await maintenanceOrderApi
      .requestBuilder()
      .create(mo)
      .execute(sdkDest);

    //  4. Update EquipmentConditions record with the Maintenance Order ID returned from S4 API
    // console.log(moId);
    // console.log(result.toJSON());
    const moResult = result.toJSON();
    const moId = moResult.maintenanceOrder;
    // console.log(moId);  // 4000223

    /** Exclusively locks the selected rows for subsequent updates in the current transaction, thereby preventing concurrent updates by other parallel transactions.
     * https://cap.cloud.sap/docs/node.js/cds-ql#select-forUpdate
     */
    try {
      let eqCond = await SELECT.from(
        EquipmentConditions,
        eqCondEntity
      ).forUpdate();
      //> EquipmentConditions is locked for other transactions
      await UPDATE(EquipmentConditions, eqCondEntity.ID).with({
        followUpDocType: "MO",
        followUpDocNum: moId,
      });
      req.notify(
        `Maintenance Order#${moId} created Successfully for Equipment#${eqCondition.equipment_NR}.`
      );
    } catch (e) {
      //> failed to acquire the lock, likely because of timeout
      req.error({
        message: "Error in updating EquipmentConditions entity on MO record.",
        target: "followUpDocNum",
        status: 418,
      });
    }
  });

  /** Logic Flow of Inferencing Sound Anomaly
   * [To-Do] Hook after-create event of anomaly to auto inference sound and update field.
   * Assumptions:
   * - Sound recordings for inference are uploaded to a specific file system location
   * - Each file follows a specific prefix e.g. "REC" + ID of the creation
   * - Bulk processing should be completed prior to this
   * - This follow method is for manual creation of a specific anomaly captured
   * - To differentiate "infered" file vs new, anomaly status will indicate 0 as new
   *
   * a. Encode Sound file (.wave) as base64
   * b. Parse base 64 as body under JSON sound parameter
   * c. Process results - Anomalous or Normal
   *
   * 1. Connect to AICORE Remote Service (defined in package.json)
   * 2. Prepare base64 format of file
   * 3. Start CDS TX to call AI Core Inference API (path is defined at the top sound_inference_url)
   * 4. Return results
   */
  this.on("inferenceSoundAnomaly", async (req) => {
    //  1. Connect to AICORE Remote Service (defined in package.json)
    const aicoreAPI = await cds.connect.to("aicore");
    const anomalyEntity = req.params[0];

    const anomaly = await SELECT.from(Anomalies, anomalyEntity).columns([
      "rawValue",
    ]);

    //  2. Prepare base64 format of file
    const fileBase64 = fs.readFileSync("app" + anomaly.rawValue, {
      encoding: "base64",
    });
    var data = JSON.stringify({
      sound: fileBase64,
    });

    var headers = {
      "AI-Resource-Group": "sound",
      "Content-Type": "application/json",
      Authorization: token,
    };

    //  3. Start CDS TX to call AI Core Inference API (path is defined at the top cv_inference_url)
    const results = await aicoreAPI
      .tx(req)
      .send("POST", sound_inference_url, data, headers);

    var confidence;

    if (results.hasOwnProperty("Normal")) {
      // console.log("Normal");
      confidence = results.Normal;
    } else {
      // console.log("Anomalous");
      confidence = results.Anomalous;
    }
    await UPDATE(Anomalies, anomalyEntity.ID).with({
      status: "2",
      confidence: confidence,
      detectedAt: new Date(),
    });

    req.notify(
      `Anomaly (ID: ` + anomalyEntity.ID + `) entity processed successfully.`
    );
  });

  /** Logic Flow of Inferencing CV Image Anomaly
   *  [To-Improve] Depends on Use Case, AICORE URL can be defined in BTP Destination.
   *  For simplicity, we use CAP's Remote Service Consumption capabilities
   *
   * 1. Connect to AICORE Remote Service (defined in package.json)
   * 2. Prepare base64 format of file
   * 3. Start CDS TX to call AI Core Inference API (path is defined at the top cv_inference_url)
   * 4. Return results
   */
  this.on("inferenceImageCV", async (req) => {
    //  1. Connect to AICORE Remote Service (defined in package.json)
    const aicoreAPI = await cds.connect.to("aicore");
    const cvImageEntity = req.params[0];

    const cvEntity = await SELECT.from(CVQualityRecords, cvImageEntity).columns(
      ["image"]
    );

    console.log(cvEntity.image);
    //  2. Prepare base64 format of file
    const fileBase64 = fs.readFileSync("app" + cvEntity.image, {
      encoding: "base64",
    });
    var data = JSON.stringify({
      image: fileBase64,
    });

    var headers = {
      "AI-Resource-Group": "defect-det",
      "Content-Type": "application/json",
      Authorization: token,
    };

    //  3. Start CDS TX to call AI Core Inference API (path is defined at the top cv_inference_url)
    const results = await aicoreAPI
      .tx(req)
      .send("POST", cv_inference_url, data, headers);

    var confidence, label;

    if (results.hasOwnProperty("Normal")) {
      // console.log("Normal");
      confidence = parseFloat(results.Normal).toFixed(2);
      label = "Y";
    } else {
      // console.log("Anomalous");
      confidence = parseFloat(results.Anomalous).toFixed(2);
      label = "N";
    }
    await UPDATE(CVQualityRecords, cvImageEntity.ID).with({
      confidence: confidence,
      qualityLabel: label,
      detectedAt: new Date(),
    });

    req.notify(
      `CV Image (ID: ` + cvImageEntity.ID + `) entity processed successfully.`
    );
  });

  //this.before("READ", "EquipmentConditions", calculateFaults);
  this.before("NEW", "CVQualityRecords", genid);
  this.before("NEW", "Anomalies", genid);
};

/** Calculate No. of Faults in each EQConditions */
async function calculateFaults(req) {
  const eqconds = await cds.tx(req).run(SELECT.from(req.target));
  const db = await cds.connect.to("db");
  const { Anomalies } = db.entities;
  for (let i = 0; i < eqconds.length; i++) {
    var eqcondId = eqconds[i].ID;
    var faults = await cds
      .tx(req)
      .run(SELECT.from(Anomalies).where({ eqCond_ID: eqcondId }));
    await UPDATE(req.target, eqcondId).with({
      fault: faults.length,
    });
  }
}

/** Generate primary keys for target entity in request */
async function genid(req) {
  const { ID } = await cds
    .tx(req)
    .run(SELECT.one.from(req.target).columns("max(ID) as ID"));
  //req.data.ID = ID - ID % 100 + 100 + 1
  req.data.ID = ID + 1;
}

/** Generate OAuth Token using clientid & clientsecret */
function generateToken(authUser) {
  var request = require("request");
  var options = {
    method: "GET",
    url: oauth_url,
    headers: {
      Authorization: authUser,
    },
  };
  request(options, function (error, response) {
    if (error) throw new Error(error);
    // console.log(response.body);
    var obj = JSON.parse(response.body);
    // console.log(obj.access_token);
    token = "Bearer " + obj.access_token;
  });
}
