var assert = require('assert')
var os = require('os')
var graygelf = require('../')
var LOG_LEVELS = ['emerg','alert','crit','error','warn','notice','info','debug']

suite('general', function () {
  test('exports a single function', function () {
    assert.equal(typeof graygelf.createClient, 'function')
  })

  test('defaults to localhost:12201 and GELF facility', function () {
    var gg = graygelf.createClient()
    assert.equal(gg.graylogHost, 'localhost')
    assert.equal(gg.graylogPort, 12201)
    assert.equal(gg.facility, 'GELF')
  })

  test('accepts to host port and facility', function () {
    var gg = graygelf.createClient({ host: 'graylog.test.local', port: 32323, facility: 'test_facility' })
    assert.equal(gg.graylogHost, 'graylog.test.local')
    assert.equal(gg.graylogPort, 32323)
    assert.equal(gg.facility, 'test_facility')
  })
})

suite('level setups', function () {
  var gg = graygelf.createClient()

  test('sets up methods for every syslog level', function () {
    LOG_LEVELS.forEach(function (level) {
      assert.equal(typeof gg[level], 'function')
    })
  })

  test('sets up streams for every syslog level', function () {
    LOG_LEVELS.forEach(function (level) {
      assert.strictEqual(gg.stream[level].writable, true, level+' should be writable')
      assert.equal(typeof gg.stream[level].write, 'function', level+' should have a write function')
      assert.equal(typeof gg.stream[level].end, 'function', level+' should have an end function')
    })
  })
})

suite('gelf messages', function () {
  var gg = graygelf.createClient({ host: 'graylog.test.local', port: 32323, facility: 'test_facility' })

  test('sets up proper gelf message', function () {
    var gelf = gg._prepJson(0, 'my message', { addn: 'data', _extra: 'field', _id: '2323232323' })

    assert.equal(gelf.version, '1.0', 'should have version: 1.0')
    assert.equal(gelf.host, os.hostname(), 'should use os.hostname for host')
    assert.equal(gelf.short_message, 'my message', 'should include short_message')
    assert.equal(gelf.full_message.addn, 'data', 'should include full_message')
    assert.equal(gelf.level, 0, 'should include level')
    assert.equal(gelf.facility, 'test_facility', 'should include facility')
    assert(gelf.timestamp, 'should include UNIX timestamp')
    assert.equal(gelf._extra, 'field', 'should include _ fields')
    assert(!gelf._id, 'should not include _id field')
  })

  test('supports binary message input', function () {
    var gelf = gg._prepJson(0, new Buffer('some characters'))
    assert.equal(gelf.short_message, 'some characters', 'should include short_message')
  })

  test('compresses gelf message properly', function (next) {
    var gelf = gg._prepJson(0, 'my message', { addn: 'data', _extra: 'field', _id: '2323232323' })

    gg._compress(gelf, function (chunk) {
      assert(Buffer.isBuffer(chunk), 'should be a buffer')
      assert.equal(chunk[0], 0x78, 'should include zlib header')
      next()
    })
  })

  test('handles chunked gelf messages properly', function (next) {
    var gelf = gg._prepJson(0, 'my message', { addn: 'data', _extra: 'field', _id: '2323232323' })
    gg.chunkSize = 100
    var index = 0
    var expectedChunks = 2

    gg._compress(gelf, function (chunk) {
      assert(Buffer.isBuffer(chunk), 'should be a buffer')
      assert.equal(chunk[0], 0x1e, 'should include chunk header')
      assert.equal(chunk[10], index++, 'should have index number')
      assert.equal(chunk[11], expectedChunks, 'should have total number')
      if (index == expectedChunks) next()
    })
  })
})

suite('error messages', function () {
  var gg = graygelf.createClient()

  test('emit errors on udp messages', function () {
    var err = 'oh no';
    gg.on('error', function (msg) { assert.equal(msg, err) })
    gg._checkError(err)
  })
})
