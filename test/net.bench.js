'use strict'

// Support mocha.
var bench = global.bench || function () {}

var net = require('net')
var tcp = require('../lighter-tcp')
var tcpPort = 9876
var netPort = 9877
var tcpServer
var netServer

function hi (socket) {
  socket.write('Hi!')
}

bench('Benchmark', function () {
  before(function (done) {
    tcpServer = tcp.serve({port: tcpPort, connection: hi})
    netServer = net.createServer(hi).listen(netPort)
    netServer.on('listening', done)
  })

  after(function (done) {
    tcpServer.close(function () {
      netServer.close(done)
    })
  })

  it('lighter-tcp', function (done) {
    var socket = new tcp.Socket({port: tcpPort})
    socket.on('data', function (chunk) {
      socket.close()
      done()
    })
  })

  it('node net', function (done) {
    var socket = net.connect({port: netPort})
    socket.on('data', function (chunk) {
      socket.destroy()
      done()
    })
  })
})
