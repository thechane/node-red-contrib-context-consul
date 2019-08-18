# node-red-contrib-context-consul
[Consul](https://www.consul.io) context store for Node-RED.

## Usage
Node-red contextStorage configuration needs to be added. The host, port, secure, ca, token, timeout, datacenter and consistent settings are just past through to [Consul lib](https://www.npmjs.com/package/consul)

```
contextStorage: {
	consul: {
		module: require("node-red-contrib-context-consul"),
		config: {				//see https://www.npmjs.com/package/consul#init for more info
			prefix: "mytest",		//all KV pairs are stored in path _nrcontext/[prefix]/ - see below
			host: "consul",			//IP or hostname of consul,
			port: 8500,			//listening consul port
			secure: false,			//TLS (https) secured?
			ca: {},				//TLS info -- ca (String[], optional): array of strings or Buffers of trusted certificates in PEM format
			//token: "something",		//Consul token if any to be included in all API calls
			timeout: 3000,			//API timeout in ms
			datacenter: "mydc",		//populates the dc option in all API calls
			consistent: true,		//consistency normal (false) or strong (true, default) - see Consul docs
			lock,				//EXPERIMENTAL - bool, default is no locking
			lockttl,			//(string: "") - Specifies the number of seconds (between 10s and 86400s).
			locknode,			//Specifies the name of the consul node. This must refer to a node that is already registered.
			lockdelay,			//(string: "15s") - Specifies the duration for the lock delay. This must be greater than 0.
			debug: false			//flag to enable console debug messages
		}
	}
}
```

When you fire up node-red up a series of checks will execute to ensure Consul is available and working as expected. If any of them fail an error is thrown and node-red will not start. The "prefix" is basically the node-red instance ID, all KV pairs will prefixed with _nrcontext/[prefix string] so multiple instances can make use of the same Consul cluster.

note - if you do not lock (still experimental) and run multiple instances using the same prefix you are asking for trouble and KV pairs may clash.

## Testing
If you have docker available, run a then docker-compose up to bring up node-red with a basic consul cluster available to store context data.

## More info
Check out these links for more info, [Node-red Context Docs, ](https://nodered.org/docs/user-guide/context) [Node-red Context API, ](https://nodered.org/docs/api/context/methods/) [Consul lib on NPM](https://www.npmjs.com/package/consul)


