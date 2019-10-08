# node-red-contrib-context-consul
[Consul](https://www.consul.io) context store for Node-RED. This allows nodes to maintain a persistent state using a Consul key value store. It's also possible to set locks for synchronization needs or setting limits etc. More on - [node-red context](https://nodered.org/docs/api/context/).

## Usage
Node-red contextStorage configuration needs to be added. The host, port, secure, ca, token, timeout, datacenter and consistent settings are just passed through to [Consul lib](https://www.npmjs.com/package/consul)

```
contextStorage: {
	consul: {
		module: require("node-red-contrib-context-consul"),
		config: { //see https://www.npmjs.com/package/consul#init for more info
			//CONFIG HERE
		}
	}
}

//CONFIG
prefix: "mytest",	//all KV stored in path _nrcontext/[prefix]/
host: "consul",		//IP or hostname of consul,
port: 8500,		//listening consul port
secure: false,		//TLS (https) secured?
ca: {},	//TLS info -- ca (String[]): array of strings or Buffers in PEM format
token: "something",	//(optional) Consul token to be included in all API calls
timeout: 3000,		//API timeout in ms
datacenter: "mydc",	//populates the dc option in all API calls
consistent: true,	//consistency normal (false) or strong (true, default)
lock: false,		//EXPERIMENTAL - bool, default is no locking
lockttl: 30s,		//(string: "") - lock time to live (between 10s and 86400s).
locknode: "server2",	//Specifies the name of the consul node,
			// this must refer to a node that is already registered.
lockdelay: "10s",	//(string:"15s") Delay before allowing locks 
			// after a session has been invalidated. (> 0).
debug: false		//Flag to enable console debug messages
```

When you fire up node-red up a series of checks will execute to ensure Consul is available and working as expected. If any of them fail an error is thrown and node-red will not start. The "prefix" is basically the node-red instance ID, all KV pairs will prefixed with _nrcontext/[prefix string] so multiple instances can make use of the same Consul cluster.

note - if you do not lock (still experimental) and run multiple instances using the same prefix you are asking for trouble and KV pairs may clash.

## Testing
If you have docker available, run a then docker-compose up to bring up node-red with a basic consul cluster available to store context data.

## More info
Check out these links for more info, [Node-red Context Docs, ](https://nodered.org/docs/user-guide/context) [Node-red Context API, ](https://nodered.org/docs/api/context/methods/) [Consul lib on NPM](https://www.npmjs.com/package/consul)


