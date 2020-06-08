var zlib = require('zlib')
var dgram = require('dgram')
var os = require('os')
var crypto = require('crypto')
var Stream = require('stream')
var format = require('util').format
var split = require('split')

const {lookup} = require('dns-lookup-cache')

var timestamp = function() { return Date.now() / 1000.0 }

/**
 * Available logging levels
 * @type {Array}
 */
var LOG_LEVELS = {
  emerg: 0,
  panic: 0,
  alert: 1,
  crit: 2,
  error: 3,
  err: 3,
  warn: 4,
  warning: 4,
  notice: 5,
  info: 6,
  debug: 7,
}

var GrayGelf = function(opts) {
  /* eslint complexity:0 */
  if (!(this instanceof GrayGelf)) {
    return new GrayGelf(opts)
  }

  if (typeof opts === 'string') opts = {host: opts}
  if (!opts) opts = {}

  this.graylogHost = opts.host || 'localhost'
  this.graylogPort = opts.port || 12201
  this.fields = Object.create(null)


  this.chunkSize = opts.chunkSize || GrayGelf.CHUNK_WAN
  this.compressType = (opts.compressType || '') === 'gzip' ? 'gzip' : 'deflate'
  this.alwaysCompress = opts.alwaysCompress || false
  this.hostname = os.hostname()

  if (!opts.mock) {
    this._udp = dgram.createSocket({
      type: 'udp4',
      lookup: (hostname, options, callback) => {
        if (hostname === '0.0.0.0' || hostname === 'localhost' || hostname === '127.0.0.1') {
          callback(null, '127.0.0.1', 4)
        } else {
          lookup(hostname, options, callback)
        }
      },
    })
    this._udp.on('error', this._emitError.bind(this))
    this._udp.unref()
  }

  this.writable = true // writable stream
  this._setupLevels()
}

GrayGelf.prototype = Object.create(Stream.prototype)

GrayGelf.prototype._setupLevels = function() {
  var graygelf = this

  Object.keys(LOG_LEVELS).forEach(function(name) {
    var level = LOG_LEVELS[name]

    graygelf[name] = function() {
      var gelf
      if (arguments.length === 1 && arguments[0] instanceof Error) {
        gelf = graygelf._prepGelf(level, arguments[0].message, arguments[0].stack)
      }
      else {
        gelf = graygelf._prepGelf(level, format.apply(null, arguments))
      }
      graygelf._send(gelf)
      return gelf
    }

    graygelf[name].a = function(short, long, fields) {
      var gelf = graygelf._prepGelf(level, short, long, fields)
      graygelf._send(gelf)
      return gelf
    }
  })
}

GrayGelf.prototype.write = function(chunk, cb) {
  if (!this._udp) return
  this._udp.send(chunk, 0, chunk.length, this.graylogPort, this.graylogHost, cb)
}

GrayGelf.prototype._emitError = function(er) { this.emit('error', er) }

GrayGelf.prototype._prepGelf = function(level, short, long, fields) {
  var gelf = {
    version: '1.1',
    host: this.hostname,
    short_message: short,
    timestamp: timestamp(),
    level: level,
  }

  if (!fields) fields = {}
  if (long) gelf.full_message = long

  for (var i in this.fields) gelf['_' + i] = this.fields[i]
  for (var j in fields) gelf['_' + j] = fields[j]

  this.emit('message', gelf)
  return gelf
}

GrayGelf.prototype._send = function(gelf, cb) {
  var gelfbuf = new Buffer(JSON.stringify(gelf))
  var graygelf = this

  if (gelfbuf.length < graygelf.chunkSize && !graygelf.alwaysCompress) {
    // The buffer fits within the nominal chunksize,
    // so compression can be bypassed and sent directly
    return graygelf.write(gelfbuf, cb)
  }

  zlib[this.compressType](gelfbuf, function(er, message) {
    /* istanbul ignore if */
    if (er) return graygelf.emit('error', er)

    if (message.length > graygelf.chunkSize) {
      var total = Math.ceil(message.length / graygelf.chunkSize)
      var offset = 0

      crypto.randomBytes(6, function(er2, idBuf) {
        /* istanbul ignore if */
        if (er2) return graygelf.emit('error', er2)

        for (var i = 0; i < total; i++) {
          var bytesToSend = offset + graygelf.chunkSize < message.length ? graygelf.chunkSize : message.length - offset
          var chunk = new Buffer(bytesToSend + 12)
          chunk[0] = 0x1e
          chunk[1] = 0x0f
          idBuf.copy(chunk, 2, 0, 6)
          chunk[10] = i
          chunk[11] = total

          message.copy(chunk, 12, offset, offset + bytesToSend)
          offset += bytesToSend
          graygelf.write(chunk, cb)
        }
      })
    }
    else graygelf.write(message, cb)
  })
}

GrayGelf.prototype.stream = function(name) {
  if (!(name in LOG_LEVELS)) throw new Error('invalid stream name')
  var stream = new Stream()
  var lines = split()
  stream.writable = true
  stream.write = this[name].bind(this)
  stream.end = function() {} // 'end' event is noop, stream always stays open
  lines.pipe(stream)
  return lines
}

GrayGelf.prototype.raw = function(raw, cb) {
  if (!raw.version) raw.version = '1.1'
  if (!raw.host) raw.host = this.hostname
  if (!raw.timestamp) raw.timestamp = timestamp()
  this._send(raw, cb)
  return raw
}

GrayGelf.CHUNK_WAN = 1240
GrayGelf.CHUNK_LAN = 8154
GrayGelf.LOG_LEVELS = LOG_LEVELS

module.exports = GrayGelf
