# node-red-contrib-context-consul
Consul context store for Node-RED

## note - Beta version
Certificates and security token options are completely untested at this point. The rest is only briefly tested, I expect to spend time getting this stable in the coming weeks.

## Usage
Node-red contextStorage configuration needs to be added, example:

```
	contextStorage: {
		consul: {
			module: require("node-red-contrib-context-consul"),
			config: {
				host: "consul",
				port: 8500,
				secure: false,
				ca: {},
				//token: "something",
				timeout: 3000,
				datacenter: "dc1",
				prefix: "dev",
				consistent: true,
				debug: true
			}
		}
	}
```

Once node-red is running you have the consul (or whatever you name it) context storage available.
The easiest way to check it to drop in a change node and set a flow or global,
the context options should appear as a dropdown on the right of the input.

Check out these links for more info, [Node-red Context Docs, ](https://nodered.org/docs/user-guide/context) [Node-red Context API, ](https://nodered.org/docs/api/context/methods/) [Consul lib on NPM](https://www.npmjs.com/package/consul)