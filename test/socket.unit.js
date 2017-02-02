'use strict'

// Support mocha.
var is = global.is || require('exam/lib/is')

var tcp = require('../lighter-tcp')
var port = 9895

var server = tcp.serve({
  port: port
})

describe('Socket.prototype', function () {
  var host = {port: port, host: 'localhost'}

  after(function (done) {
    server.close(done)
  })

  describe('.local', function () {
    it('returns zero until connected', function (done) {
      var socket = tcp.connect(host)
      var local = socket.local
      is(local, 0)
      socket.close(done)
    })

    it('returns local socket info', function (done) {
      tcp.connect({
        port: port
      }).on('connect', function () {
        var local = this.local
        is.string(local.address)
        is.number(local.port)
        local = this.local
        is.string(local.address)
        is.number(local.port)
        this.close(done)
      })
    })
  })

  describe('.remote', function () {
    it('returns zero until connected', function (done) {
      var socket = tcp.connect(host)
      var remote = socket.remote
      is(remote, 0)
      socket.close(done)
    })

    it('returns remote socket info', function (done) {
      tcp.connect({
        port: port
      }).on('connect', function () {
        var remote = this.remote
        is.string(remote.address)
        is.number(remote.port)
        remote = this.remote
        is.string(remote.address)
        is.number(remote.port)
        this.close(done)
      })
    })
  })
})
