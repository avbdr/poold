const Gpio = require('onoff').Gpio;

class gpioUnit {

    constructor(app, cfg) {
        this.app = app;
        cfg.options = {reconfigureDirection: false};
        if (!cfg.gpioMode) {
            cfg.gpioMode = "out";
        }
        if (!cfg.gpioEdgeMode) {
            cfg.gpioEdgeMode = "none";
        }
        if (cfg.gpioMode == 'in') {
            cfg.options.debounceTimeout = 100;
        }

        this.cfg = cfg;
        try {
            this.device = new Gpio(cfg.gpio, cfg.gpioMode , cfg.gpioEdgeMode, cfg.options);
        } catch (e) {
            console.log("[GPIO] Can not configure GPIO %s. Device unavailable: %s", cfg.gpio, e);
            return;
        }
        console.log("[GPIO] Configuring GPIO %s in %s mode", cfg.gpio, cfg.gpioMode);
        if (cfg.gpioMode == 'in') {
            console.log("[GPIO] Listening for events");
            this.monitorGpio();
        }
    }

    setStatus(status) {
        var op = 0;
        if (status == "ON") {
            op = 1;
        }
        this.device.writeSync(op);
        return status;
    }

    getStatus() {
        if (!this.device) {
            console.log ("[GPIO] Device is not available. Please verify your hardware");
            return "ERROR";
        }
        var op = this.device.readSync();
        if (op == 0) 
            return "OFF";
        return "ON";
    }

    monitorGpio() {
        this.device.watch((err, value) => {
            if (err) {
                console.log ("[GPIO] New event error occured: %s", error);
                throw err;
            }
            console.log ("[GPIO] New event occured: %s", value);
        });
    }
}
module.exports = gpioUnit;
