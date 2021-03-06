var promise = require('bluebird');

/**
 * API Helper Object has convenience functions for implementing your custom communications protocol.
 * @class CommApi
 * @param socket
 */
module.exports = CommApi;

function CommApi(socket, port, multicastAddress) {
    this._socket = socket;
    this._port = port;
    this._multicastAddress = multicastAddress;
}


/**
 * Broadcast a message to all listeners.
 *
 * Listeners will need to connect to the same port and multicastAddress as the sender to receive messages.
 *
 * @param {Buffer|string} message - Message to send
 *
 * @fulfil No value.  The buffer is safe to reuse now.
 * @reject {Error} err - Error returned from socket
 *
 * @returns {Promise}
 *
 * @since 1.0.0
 *
 * @example
 * ```js
 * var ipc = require('multicast-ipc');
 *
 * // Announcer BOT will tell everyone when someone joins the room!
 * ipc.withSocket(function (api) {
 *   function isJoinMessage(message, rinfo) {
 *       return message.toString().substr(0, 5) == 'join:';
 *   }
 *
 *   return api.waitForMessage(isJoinMessage)
 *             .map(function (req) {
 *                 // Send a message to all listeners
 *                 
 *                 return api.broadcast('Player ' + req.message.toString().substr(5) + ' has entered the arena!');
 *             };
 * });
 * ```
 */
CommApi.prototype.broadcast = function (message) {
    return this.send(message, this._port, this._multicastAddress);
};

/**
 * Send a message directly to a port/ip address.
 *
 * This function can be used for 1:1 communication as well as for group messaging if the IP address happens to be
 * one that is in the multicast range.
 *
 * If the value of address is a host name, DNS will be used to resolve the address of the host which will incur at least
 * one processTick delay. If the address is an empty string, '127.0.0.1' or '::1' will be used instead.
 *
 * @param {Buffer|string} message - The message to send
 * @param {number} port - UDP port to send data to
 * @param {string} ipAddress - Destination hostname or IP address
 *
 * @fulfil No value
 * @reject {Error} err - Error from sending the command
 *
 * @returns {Promise}
 *
 * @since 1.0.0
 *
 * ```js
 * var ipc = require('multicast-ipc');
 *
 * // Welcome BOT will welcome new players
 * ipc.withSocket(function (api) {
 *   // Send a message to all listeners
 *
 *   function isJoinMessage(message, rinfo) {
 *       return message.toString().substr(0, 5) == 'join:';
 *   }
 *
 *   return api.waitForMessage(isJoinMessage)
 *             .map(function (req) {
 *                 // Send a direct message as a 'reply' back to the process that sent the original message
 *
 *                 return api.send('Welcome ' + req.message.toString().substr(5) + '!', req.port, req.address);
 *             };
 * });
 * ```
 */
CommApi.prototype.send = function send(message, port, ipAddress) {
    var socket = this._socket;
    var messageBuffer = new Buffer(message);

    return promise.fromCallback(function (callback) {
        socket.send(messageBuffer, 0, messageBuffer.length, port, ipAddress, callback);
    });
};

/**
 * Unbind socket.  No more communication can be done through this promise chain after this.
 *
 * @fulfil Socket closed successfully
 * @reject {Error} err - Socket could not be closed
 *
 * @returns {Promise}
 *
 * @since 1.0.0
 */
CommApi.prototype.unbind = function unbind() {
    var socket = this._socket;

    return promise.fromCallback(function (callback) {
        socket.close(callback);
    });
};

/**
 * Wait for a specific message.  The optional filter function is called for every message that is received.  If the filter
 * function returns true, the promise is resolved with that value.
 *
 * @param {function} [filter] - Each received message is passed into the filter function.
 *
 * @fulfil {{ address: string, family: string, port: number, message: Buffer }} message - The message that was received
 * @reject {Error} err - Error thrown from the filter function
 *
 * @returns {Promise}
 *
 * @since 1.0.0
 *
 * ```js
 * var ipc = require('multicast-ipc');
 *
 * // Logger BOT will log incoming messages
 * ipc.withSocket(function (api) {
 *   function isJoinMessage(message, rinfo) {
 *       return message.toString().substr(0, 5) == 'join:';
 *   }
 *
 *   return api.waitForMessage(isJoinMessage)
 *             .map(function (req) {
 *                 console.log('Audit Log: %s:%d - %s', req.address, req.port, req.message.toString());
 *             };
 * });
 * ```
 */
CommApi.prototype.waitForMessage = function waitForMessage(filter) {
    var socket = this._socket;

    return repeatWhile(function (message) {
        return typeof message === 'undefined';
    }, function () {
        var fn;

        return new promise(function (resolve) {
            fn = processMessage;

            socket.once('message', fn);

            function processMessage(message, rinfo) {
                if (typeof filter !== 'function' || filter(message, rinfo) === true) {
                    rinfo.message = message;

                    resolve(rinfo);
                } else {
                    resolve(undefined);
                }
            }
        }).error(function () { socket.removeListener('message', fn); });
    }, undefined);
};

var repeatWhile = promise.method(function(condition, action, lastValue) {
    if (!condition(lastValue)) return lastValue;

    return action(lastValue).then(repeatWhile.bind(null, condition, action));
});

/**
 * Repeat a certain chain of commands until the specified condition is met.  This is the equivalent of a while loop.
 *
 * The ```condition``` function is used to decide whether to continue looping or stop.  It receives the last value from
 * the action function as input and should return ```true``` to continue the loop or false to ```stop```.
 *
 * The ```action``` function contains the body of the loop.  This is typically an entire back and forth interaction of the
 * protocol using {@link #CommApi+broadcast broadcast}, {@link #CommApi+send send} and
 * {@link #CommApi+waitForMessage waitForMessage} functions.  The end result should be a
 * promise that resolves to a value which will be passed into the ```condition``` function.
 *
 * @param {function} condition - A callback function that receives the "lastValue" and returns true to continue repeating
 * @param {function} action - A callback function that must return a promise
 * @param {*} lastValue - This is the first "lastValue" that will be passed to the condition function
 *
 * @fulfil {*} The latest lastValue
 * @reject {Error} err - Error thrown by either the condition function or the action function
 *
 * @returns {Promise}
 *
 * @since 1.0.0
 */
CommApi.prototype.repeatWhile = repeatWhile;

/**
 * Repeat a set of commands for a specific number of times
 *
 * @param {number} count - The number of times that ```fn``` should be called
 * @param {function} fn - The function that should be repeated
 *
 * @fulfil {number} lastValue - The last value of the for..loop (always 0)
 * @reject {Error} err - Error thrown from the ```fn``` function
 *
 * @returns {Promise}
 *
 * @since 1.0.0
 */
CommApi.prototype.repeatFor = function repeatFor(count, fn) {
    return repeatWhile(function (lastValue) { return lastValue > 0; }, function (lastValue) {
        return promise.try(fn).then(function () { return promise.resolve(--lastValue); });
    }, count);
};
