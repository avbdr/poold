const rpmFromPercent = require('../utils').rpmFromPercent;
const rpmToPercent =require('../utils').rpmToPercent;
const dec2hex = require('../utils').dec2hex;
const now = require('../utils').now;
const serialWrite = require('../utils').serialWrite;
const startWatchdog = require('../utils').startWatchdog;
const { DelimiterParser } = require('@serialport/parser-delimiter')

class haywardvspUnit {
    PUMP_SET_SPEED_REQ = 12;
    PUMP_REMOTE_CONTROL_REQ = 1;
    // FIXME probably should be 500 - 1500
    PUMP_RESEND_INTERVAL = 5000;
    PUMP_ANSWER_LENGTH = 13;
    maxSpeed = 3450;
    avgSpeed = 1450;
    minSpeed = 350;

    constructor(app, opts) {
        this.app = app;
        this.cfg = opts;
        this.serial = app.serial;
        this.timer = 0;
        this.status = "OFF";
        this.reqSpeed = 0;
        this.curSpeed = 0;
        this.watts = 0;

        this.address = opts.address;
        this.myself = 1;
        this.lastReply = now();
        console.log("Initializing Hayward Tristar/Ecostar VS Pump");
        this.initWatchdog();

        // initialize rs485 connection
        const parser = this.serial.pipe(new DelimiterParser({ includeDelimiter: true, delimiter: Buffer.from([0x10,0x03]) }));
        parser.on('data', (data) => {
            this.processReply(data);
        });
    }
    
    buildRequest (action, payload, addressOverwrite) {
        // [START OF PACKET BYTES]: 2 byte. fix bytes which indicates Start of Packet [0x10 0x02]
        // [ACTION]: 1 byte. action 12/0x0C -- set RPM,  action 1/0x01 -- set remote control
        // [SOURCE ADD]: 1 byte. Byte Source Address [0x01] Source address can be 12(broadcast) in some operations
        // [DESTINATION ADD]: 1 byte. Byte Destination Address [0x0C]
        // [DATA] : 1- byte Data - RPM Data in Parentage 0% - 100% [0x64]
        // [CHECKSUM] : 2 Byte Checksum [0x00 0x83]
        // [END OF PACKET BYTES]: 2-bytes fix bytes which indicates END of Packet [0x10 0x03]
        // Example (address 0x00: all dip switches off (Pool Filter), address 0x02: 2nd dip switch on (Aux 1)) 
        // on 45%  [0x10, 0x02, 0x0C, 0x01, 0x00, 0x2D, 0x00, 0x4C, 0x10, 0x03]
        // on 100% [0x10, 0x02, 0x0C, 0x01, 0x0C, 0x64, 0x00, 0x83, 0x10, 0x03]
        // off     [0x10, 0x02, 0x0C, 0x01, 0x00, 0x00, 0x00, 0x1F, 0x10, 0x03]

        var data = Buffer.from([0x10, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x03]);
        // set action
        data[2] = dec2hex(action);
        // set source. We can use addressOverwrite if we need to send as broadcase for example
        if (addressOverwrite)
            data[3] = dec2hex(addressOverwrite);
        else
            data[3] = dec2hex(this.myself);
        // set destination
        data[4] = dec2hex(this.address);
        // set payload
        data[5] = dec2hex(payload);
        // calculate CRC
        // FIXME data[6] = should be first byte of the crc if crc is 2 bytes
        data[7] = data[0] + data[1] + data[2] + data[3] + data[4] + data[5] + data[6];
        return data;
    }

    getStatus() {
        var reply = {
            'status': this.status,
            'speed': this.curSpeed,
            'watts': this.watts
        };
        return JSON.stringify(reply);
    }

    setSpeed(speed, speedOverride) {
        if (speed == 'ON')
            speed = this.avgSpeed;

        if (speed == 'OFF')
            speed = 0;

        if (speed < this.minSpeed || speed > this.maxSpeed) {
            if (speed != 0)
                return JSON.stringify({"status": "Error", "message": "Wrong speed requested"});
        }

        var percent = rpmToPercent (this.maxSpeed, speed);
        console.log("[haywardvsp] Setting pump speed to %d RPM (%d%)", speed, percent);
        console.log("[haywardvsp] Clearing Timer #" + this.timer);
        clearTimeout(this.timer);
        var req = this.buildRequest (this.PUMP_SET_SPEED_REQ, percent);
        if (speed > 0) {
            this.status = "ON";
            // every 5 seconds we have to repeat the command to the pump. Otherwise it will shut down
            serialWrite (req, this, this.PUMP_RESEND_INTERVAL);
        } else {
            this.status = "OFF";
            serialWrite (req, this);
        }
        if (!speedOverride)
            this.reqSpeed = speed;
        return this.getStatus();
    }

    setRemoteControl() {
        console.log ("[haywardvsp] Requesting Remote Pump Control");
        var req = this.buildRequest (this.PUMP_REMOTE_CONTROL_REQ, 255);
        serialWrite (req, this);
    }

    initWatchdog() {
        startWatchdog(this, (delta) => {
            if (this.status == 'OFF')
                return;

            console.log("Pump is not answering for %d sec. Priming for 1 minute", delta);
            this.watts = 0;
            this.setSpeed(this.maxSpeed - 150, true);
            /*setTimeout(function() {
                console.log("resetting pump speed back to %s", this.speed);
                this.setSpeed(this.speed, true);
            }, 60000);*/
            this.app.publishUnitsState(this.cfg.name);
        });
    }

    processReply(data) {
        // [START OF PACKET BYTES]: 2 byte. fix bytes which indicates Start of Packet [0x10 0x02]
        // [SOURCE ADD]: 1 byte. Byte Source Address [0x01] Source address can be 12(broadcast) in some operations
        // [ACTION]: 1 byte. action 12/0x0C -- set RPM,  action 1/0x01 -- set remote control
        // [DESTINATION ADD]: 1 byte. Byte Destination Address [0x0C]
        // [STATUS]: 1 byte. Pump Returns 0 in case of successfull acction or 100 in case of failure
        // [SPEED] : 1- byte Data - RPM Data in Parentage 0% - 100% [0x64]
        // [WATTS] : 2 byte Data - Pump electricity consumption
        // [CHECKSUM] : 2 Byte Checksum [0x00 0x83]
        // [END OF PACKET BYTES]: 2-bytes fix bytes which indicates END of Packet [0x10 0x03]
        //            src   act   dest  err   spd   watt1 watt2 crc1  crc2
        //0x10, 0x02, 0x00, 0x0C, 0x00, 0x00, 0x2D, 0x02, 0x36, 0x00, 0x83, 0x10, 0x03

        var len = data.length;
        if (len != this.PUMP_ANSWER_LENGTH) {
            if (this.cfg.debug == "network") { console.log("[haywardvsp] Message of a wrong length %d: ", len, data); }
            return;
        }
        if (!(data[0] == 0x10 && data[1] == 0x02) && !(data[len - 2] == 0x10 && data[len - 1] == 0x03)) {
            if (this.cfg.debug == "network") { console.log("[haywardvsp] Message not for us: ", data); }
            return;
        }
        var src = data[2];
        if (src != this.address) {
            if (this.cfg.debug == "network") console.log ("[haywardvsp] Ignoring message from different address #%d", src, data);
            return;
        } else {
            if (this.cfg.debug == "network") console.log ("[haywardvsp] Message from pump #%d", src, data);
        }

        var crc = data[0] + data[1] + data[2] + data[3] + data[4] + data[5] + data[6] + data[7] + data[8];
        if (crc != data[9] + data[10]) {
            console.log ("[haywardvsp] CRC mismatch. expected: %d received: %d", crc, data[9] + data[10]);
//            return;
        }

        var action = data[3];
        var dst = data[4];
        var statusCode = parseInt(data[5], 16);
        var speedPercent = data[6];
        this.curSpeed = rpmFromPercent(this.maxSpeed, speedPercent);
        this.watts = parseInt(data[7].toString(16) + data[8].toString(16), 10);
        this.lastReply = now();
        if (this.cfg.debug == "network") {
            console.log ("[haywardvsp] Reply from: %d to: %d action: %d status: %d speed: %dRPM (%d%) consumption: %dW",
                         src, dst, action, statusCode, this.curSpeed, speedPercent, this.watts);
        }

        if (statusCode == 100) {
            this.curSpeed = 0;
            this.watts = 0;
        }

        if (action == this.PUMP_SET_SPEED_REQ) {
            this.app.publishUnitsState(this.cfg.name);
        }
    }
};

module.exports = haywardvspUnit; 
