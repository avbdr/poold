const cfg = require('./config.json');
const SerialPort = require('serialport').SerialPort;
const { MockBinding } = require('@serialport/binding-mock');
const gpioUnit = require('./units/gpioUnit');
const haywardvspUnit = require('./units/haywardvspUnit.js');
const mqtt = require('mqtt');
const http = require('http');
const url = require('url');

var app = {};
var clientId = cfg.mqtt.clientId;

function initUnits() {
    Object.keys(cfg.units).forEach ((unitName) => {
        var unit = cfg.units[unitName];
        var unitTypeObj = cfg.units[unitName].type + "Unit";
	    cfg.units[unitName].device = eval("new " + unitTypeObj + "(app, cfg.units[unitName])");
        cfg.units[unitName].name = unitName;
    });
}

function publishUnitsState(unitNameReq) {
    mqttClient.publish("tele/" + clientId + '/online', 'true')
    Object.keys(cfg.units).forEach ((unitName) => {
        if (unitNameReq && unitName != unitNameReq) {
            return;
        }
        var unit = cfg.units[unitName];
        var status = unit.device.getStatus();
        mqttClient.publish("tele/" + clientId + '/' + unitName + '/RESULT', status);
    });
}
app.publishUnitsState = publishUnitsState;

function processMqttCommand(unitName, cmd, args) {
   if (unitName == "getStatus") {
        publishUnitsState();
        return;
   }

   if(!cfg.units[unitName]) {
      console.log("[MQTT] Invalid request [%s] cmd %s args %s", unitName, cmd, args);
      mqttClient.publish("tele/" + clientId + '/' + unitName + '/RESULT', "invalid unit")
      return;
   }

   var result = "unknown command";
   var device = cfg.units[unitName].device;
   if (device[cmd]) {
        result = device[cmd](args);
   }
   console.log("[MQTT] Request [%s] cmd %s args %s reply %s", unitName, cmd, args, result);
   mqttClient.publish("tele/" + clientId + '/' + unitName + '/RESULT', result);
}

function initSerial () {
    if (!cfg.serial.port) {
        return;
    }

    if (cfg.serial.port == "/dev/mock") {
        console.log ("[SERIAL-test] Creating mock port");
        MockBinding.createPort(cfg.serial.port, { echo: true, record: true })
    }

    console.log("[SERIAL] Connecting to " + cfg.serial.port);
    app.serial = new SerialPort({
        path: cfg.serial.port,
        baudRate: cfg.serial.baudrate,
        dataBits: 8, stopBits: 2, parity: 'none',
        //binding: MockBinding
    });
}

initSerial();
initUnits();

var mqttClient = mqtt.connect("mqtt://" + cfg.mqtt.host , cfg.mqtt);
mqttClient.on("connect",function() {	
    console.log("[MQTT] Connected to mqtt://" + cfg.mqtt.host);
    mqttClient.subscribe(clientId + "/#");
    publishUnitsState();  
    setTimeout(() => {
        publishUnitsState();  
    }, 60000)
});

mqttClient.on('message', (topic, message) => {
    var [devicename, unit, cmd] = topic.split("/");
    processMqttCommand(unit, cmd, message.toString());
})

mqttClient.on('reconnect', () => {
  console.log("[MQTT] Reconnecting to " + cfg.mqtt.host);
});

mqttClient.stream.on('error', e => {
  console.error('[MQTT] Error:', e)
});

mqttClient.on('close', () => {
  console.log(`[MQTT] Disconnected`)
});


const requestListener = function (req, res) {
    res.setHeader("Content-Type", "application/json");
    var uri = url.parse(req.url, true);
    switch (uri.pathname) {
        case "/test":
            var data1 = Buffer.from([0x10, 0x02, 0x00, 0x0C, 0x00, 0x00, 0x2D, 0x02, 0x36, 0x00, 0x83, 0x10, 0x03]);
            var data2 = Buffer.from([0x10, 0x02, 0x00, 0x0C, 0x00, 0x00, 0x2D]);
            var data3 = Buffer.from([0x02, 0x36, 0x00, 0x83, 0x10, 0x03]);
            app.serial.port.emitData(data1);
            app.serial.port.emitData(data2);
            app.serial.port.emitData(data3);
            res.writeHead(200);
            res.end("OK");
            break
    }
}

const server = http.createServer(requestListener);
server.listen("8082", () => {
    console.log("Server is running");
});

