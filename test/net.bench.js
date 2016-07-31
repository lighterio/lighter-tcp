var net = require('net')
var tcp = require('../lighter-tcp')
var tcpPort = 9876
var netPort = 9877

function hi (socket) {
  socket.write('Hi!')
}

var tcpServer = tcp.serve({port: tcpPort, connection: hi})
var netServer = net.createServer(hi).listen(netPort)

bench('Benchmark', function () {
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
