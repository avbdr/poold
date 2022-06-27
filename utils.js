function rpmFromPercent(maxSpeed, percent) {
    return Math.ceil((maxSpeed * percent)  / 100);
}

function rpmToPercent(maxSpeed, speed) {
    return Math.ceil((speed / maxSpeed) * 100);
}

function dec2hex(num, padding) {
    if (!padding)
        padding = 2;
    return "0x" + num.toString(16).padStart(padding, '0')
}

function serialWrite(data, interval, device) {
    if (device && device.serial) {
        device.serial.write(data, function(err) {
            console.log("[HaywardVSP]  sent: ", data);
        });
    } else {
        console.log("[HaywardVSP-test] sent: ", data);
    }

    if (interval && device) {
        device.timer = setTimeout(function() {
            serialWrite(data, interval, device);
        }, interval);
    }
}


var log = console.log;
console.log = function () {
    var first_parameter = arguments[0];
    var other_parameters = Array.prototype.slice.call(arguments, 1);

    function formatConsoleDate (date) {
        var hour = date.getHours();
        var minutes = date.getMinutes();
        var seconds = date.getSeconds();
        var milliseconds = date.getMilliseconds();

        return ((hour < 10) ? '0' + hour: hour) +
               ':' +
               ((minutes < 10) ? '0' + minutes: minutes) +
               ':' +
               ((seconds < 10) ? '0' + seconds: seconds) +
               '.' +
               ('00' + milliseconds).slice(-3) + ' ';
    }

    log.apply(console, [formatConsoleDate(new Date()) + first_parameter].concat(other_parameters));
};

module.exports.rpmFromPercent = rpmFromPercent;
module.exports.rpmToPercent = rpmToPercent;
module.exports.dec2hex = dec2hex;
module.exports.serialWrite = serialWrite;
