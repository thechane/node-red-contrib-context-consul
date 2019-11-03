
/**
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
 **/

/**
  Consul based context storage

  Please refer to https://github.com/thechane/node-red-contrib-context-consul and
  https://nodered.org/docs/api/context/methods/ and
  https://www.npmjs.com/package/consul for more information.

  node-red settings.js / config file, add to context section:
	{
        module: require("node-red-contrib-context-consul"),
        config: {					//see https://www.npmjs.com/package/consul#init for more info
            host: "consul",			//IP or hostname of consul
            port: 8500,				//listening consul port
            secure: false,			//TLS (https) secured?
            ca: {},					//TLS info -- ca (String[], optional): array of strings or Buffers of trusted certificates in PEM format
            token: "something",		//Consul token if any to be included in all API calls
            timeout: 3000,			//API timeout in ms
    		datacenter: "dc1",		//populates the dc option in all API calls
    		prefix: "dev",			//all KV pairs are stored in path _nrcontext/[prefix]/ - see below
    		consistent: true,		//consistency normal (false) or strong (true, default) - see Consul docs
    		lock,					//boolean, lock on or off (default false)
    		lockttl,				//(string: "") - Specifies the number of seconds (between 10s and 86400s).
    		locknode,				//Specifies the name of the consul node. This must refer to a node that is already registered.
    		lockdelay,				//(string: "15s") - Specifies the duration for the lock delay. This must be greater than 0.
    		debug: false			//flag to enable console debug messages
        }
	}

 Key Value store structure:

 _nrcontext
   └──[prefix config option]
   			├────_hello					<-- ping test
   			├────_consulContextLock		<-- used to lock session
		   	├────global
		   	│      	├── key/value
		   	│      	├── key/value
		   	├────<id of Flow 1>
		   	│      	├── key/value
		   	│      	├── key/value
		   	│      	└── key/value
		   	└────<id of Flow 2>
		          	├── key/value
		          	├── key/value
		          	└── key/value

 */

let fetchValue = (client, k, debug) => {
	if (debug) console.info("DEBUG:ConsulContext:fetchValue:" + k);
	return client.kv.get({"key": k, "buffer": true})
	.catch((err) => {
		if ("statusCode" in err && err.statusCode == 404) {
			if (debug) console.info("DEBUG:ConsulContext:fetchValue:nullresponse");
			return(undefined);	//copied from localfilesystem built in, return undefined if nothing found
		} else {
			throw err;
		}
	}).then((result) => {
		if (!("Value" in result)) {
			if (debug) console.info("DEBUG:ConsulContext:fetchValue:consul:" + k + ":no Value in result");
			return(undefined);	//copied from localfilesystem built in, return undefined if nothing found
		}
		return result.Value;
	}).catch((err) => {
		throw new Error("ERROR:ConsulContext:fetchValueFailed:consul:" + err);
	}).then((result) => {
		if (debug) console.info("DEBUG:ConsulContext:fetchValue:result:" + result);
		return JSON.parse(result.toString());
	}).catch((err) => {
		throw new Error("ERROR:ConsulContext:fetchValue:failed to return parsed value:" + err);
	});
}

let sendKV = (client, k, v, debug) => {
	if (debug) console.info("DEBUG:ConsulContext:sendKV:" + k + ":" + v);
	return client.kv.set({"key": k, "value": Buffer.from(JSON.stringify(v))}).then((result) => {
		if (result === null) {
			throw new Error("ERROR:ConsulContext:sendKV:null result for key:" + k);
		} else if (typeof result !== "boolean") {
			throw new Error("ERROR:ConsulContext:sendKV:non bool result for key:" + k);
		} else if (! result) {
			throw new Error("ERROR:ConsulContext:sendKV:false response returned from consul for key:" + k + ":" + result);
		}
	}).catch((err) => {
		throw new Error("ERROR:ConsulContext:sendKVfailed:consul:" + err);
	});
}

let fetchKeys = (client, k, debug, debugmore) => {
	if (debug) console.info("DEBUG:ConsulContext:fetchKeys:" + k);
	return client.kv.keys({"key": k}).then((result) => {
		if (result == null) {
			throw new Error("ERROR:ConsulContext:fetchKeys:nullOrUndefinedResponseFromConsul");
		} else if (! Array.isArray(result)) {
			throw new Error("ERROR:ConsulContext:Keys returned a non array value:" + JSON.stringify(result));
		} else {
			if (debug) console.info("DEBUG:ConsulContext:fetchKeys:consul:keys:" + JSON.stringify(result));
			return result;
		}
	}).catch((err) => {
		if ("statusCode" in err && err.statusCode == 404) {
			if (debug) console.info("DEBUG:ConsulContext:fetchKeys:no consul keys found at " + k);
			return([]);
		}
		throw new Error("ERROR:ConsulContext:fetchKeysFailed:" + err);
	});
}

let deleteKey = (client, k, debug) => {
	if (debug) console.info("DEBUG:ConsulContext:deleteKey:" + k);
	return client.kv.del({"key": k}).then(() => {
		if (debug) console.info("DEBUG:ConsulContext:deleteKey:complete:" + k);
	}).catch((err) => {
		throw new Error("ERROR:ConsulContext:deleteKeyFailed:consul:" + k + ":" + err);
	});
}

//Construct and override
let ConsulContext = function(config) {
	if (typeof config !== "object") throw new Error("ERROR:ConsulContext:config:non object");
	this.debug 		= false;
	this.debugmore 	= false;
	this.lock 		= false;
	this.sessionid	= null;
	this.locknode	= null;
	config.defaults = {};

	if (!("prefix" in config)) throw new Error("ERROR:ConsulContext:config:prefix:missing");
	if (typeof config.prefix !== "string") throw new Error("ERROR:ConsulContext:config:prefix:non string");
	this.prefix = "_nrcontext/" + config.prefix;	//will prefix the KV pairs with _nrcontext/[config_prefix] so that flows are uniquely handled
	delete(config.prefix);

	if ("datacenter" in config) {	//Sets the consul datacenter value in each API call (if none consul default = local)
		if (typeof config.datacenter !== "string") throw new Error("ERROR:ConsulContext:config:datacenter:non string");
		config.defaults.dc = config.datacenter;
		delete(config.datacenter);
	}
	if ("token" in config) {		//ACL token for all API calls
		if (typeof config.token !== "string") throw new Error("ERROR:ConsulContext:config:token:non string");
		config.defaults.token = config.token;
		delete(config.token);
	}
	if ("consistent" in config) {	//but can be overridden
		if (typeof config.consistent !== "boolean") throw new Error("ERROR:ConsulContext:config:consistent:non boolean");
		config.defaults.consistent = config.consistent;
		delete(config.datacenter);
	} else {
		config.defaults.consistent = true;
	}
	if ("timeout" in config) {		//Sets the API timeouts in ms
		if (typeof config.timeout !== "string" && typeof config.timeout !== "number") throw new Error("ERROR:ConsulContext:config:timeout:non number|string");
		config.defaults.timeout = config.timeout;
		delete(config.timeout);
	}
	if ("debug" in config && config.debug) {		//enable debugging to console
		this.debug = true;
		delete(config.debug);
	}
	if ("debugmore" in config && config.debug) {	//enable more debugging to console
		this.debugmore = true;
		delete(config.debugmore);
	}
	if ("lock" in config) {			//enable lock to maintain exclusivity or die
		if (typeof config.lock !== "boolean") throw new Error("ERROR:ConsulContext:config:lock:non boolean");
		if (config.lock) {
			if (!("locknode" in config)) throw new Error("ERROR:ConsulContext:config:lock requested with no locknode");
			this.lock = config.lock;
			config.defaults.name = this.prefix;
		}
		delete(config.lock);
	}
	if ("lockttl" in config) {
		if (typeof config.lockttl !== "string") throw new Error("ERROR:ConsulContext:config:lockttl:non string");
		config.defaults.ttl = config.lockttl;
		delete(config.lockttl);
	}
	if ("lockdelay" in config) {
		if (typeof config.lockdelay !== "string") throw new Error("ERROR:ConsulContext:config:lockdelay:non string");
		config.defaults.lockdelay = config.lockdelay;
		delete(config.lockdelay);
	}
	if ("locknode" in config) {
		if (typeof config.locknode !== "string") throw new Error("ERROR:ConsulContext:config:locknode:non string");
		this.locknode = config.locknode;
		delete(config.locknode);
	}
	config.promisify = true;		//enforces consul to return promises rather than callbacks which we then just feed back into node-red context API
	this.config = config;
	this.client = null;
}

ConsulContext.prototype.open = function() {
	if (this.debug) console.info("DEBUG:ConsulContext:initialing with settings:" + JSON.stringify(this.config));
	this.client = require('consul')(this.config);

	//Test functionality of all the consul calls before allowing node-red to ok this context plugin
	var promiseArray 	= [];
	promiseArray.push(		//validate connectivity
		sendKV(this.client, this.prefix + "/_hello", "world", this.debug)
		.then(result => {
			if (this.debug) console.info("DEBUG:ConsulContext:setvalue_test:success");
		}).catch((err) => {
			throw new Error("ERROR:ConsulContext:open:setvalue_test1:fail:" + err);
		}).then(() => fetchValue(this.client, this.prefix + "/_hello", this.debug))
		.then(result => {
			if (! result) throw new Error("ERROR:ConsulContext:open:fetchValue_test:no result");
			if (result !== "world") throw new Error("ERROR:ConsulContext:open:fetchValue_test:" + JSON.stringify(result) + " does not match expected:\"world\"");
			if (this.debug) console.info("DEBUG:ConsulContext:fetchValue_test:success:" + JSON.stringify(result));
		}).catch((err) => {
			throw new Error("ERROR:ConsulContext:open:fetchValue_test1:fail:" + err);
		})
	);

	promiseArray.push(		//validate functionality
		sendKV(this.client, this.prefix + "/deleteme", true, this.debug)
		.then(result => {
			if (this.debug) console.info("DEBUG:ConsulContext:setvalue_test2:success");
		}).catch((err) => {
			throw new Error("ERROR:ConsulContext:open:setValue_test2:fail:" + err);
		}).then(() => fetchValue(this.client, this.prefix + "/deleteme", this.debug))
		.then(result => {
			if (! result) throw new Error("ERROR:ConsulContext:open:fetchValue_test2:no result");
			if (typeof result !== "boolean") throw new Error("ERROR:ConsulContext:open:fetchValue_test2:" + JSON.stringify(result)) + " does not match expected:\"delete failed\"}";
			if (this.debug) console.info("DEBUG:ConsulContext:fetchValue_test2:success:" + JSON.stringify(result));
		}).catch((err) => {
			throw new Error("ERROR:ConsulContext:open:fetchValue_test2:fail:" + err);
		}).then(() => fetchKeys(this.client, this.prefix, this.debug, this.debugmore))
		.then(result => {
			if (! result) throw new Error("ERROR:ConsulContext:open:fetchKeys_test:no result");
			let testok = false;
			for (var i = 0; i < result.length; i++) {
				if (this.debugmore) console.info("DEBUG:ConsulContext:fetchKeys_test:checking key:" + result[i]);
				if (result[i].endsWith("deleteme")) testok = true;
			}
			if (! testok) throw new Error("ERROR:ConsulContext:open:fetchKeys_test:deleteme:not found in results:" + JSON.stringify(result));
			if (this.debug) console.info("DEBUG:ConsulContext:fetchKeys_test:success:" + JSON.stringify(result));
		}).catch((err) => {
			throw new Error("ERROR:ConsulContext:open:fetchkeys_test2a:fail:" + err);
		}).then(() => deleteKey(this.client, this.prefix + "/deleteme", this.debug))
		.then(result => {
			if (this.debug) console.info("DEBUG:ConsulContext:deleteKey_test:success:" + JSON.stringify(result));
		}).catch((err) => {
			throw new Error("ERROR:ConsulContext:open:deleteValue_test2:fail:" + err);
		}).then(() => fetchKeys(this.client, this.prefix, this.debug, this.debugmore))
		.then(result => {
			if (! result) throw new Error("ERROR:ConsulContext:open:fetchKeys_test2:no result");
			let testok = true;
			for (var i = 0; i < result.length; i++) {
				if (this.debugmore) console.info("DEBUG:ConsulContext:fetchKeys_test2:checking key:" + result[i]);
				if (result[i].endsWith("deleteme")) testok = false;
			}
			if (! testok) throw new Error("ERROR:ConsulContext:open:fetchKeys_test2:deleteme:still found in results:" + JSON.stringify(result));
			if (this.debug) console.info("DEBUG:ConsulContext:fetchKeys_test2:success:" + JSON.stringify(result));
		}).catch((err) => {
			throw new Error("ERROR:ConsulContext:open:fetchkeys_test2b:fail:" + err);
		})
	);

	if (this.lock) {
		if (this.debug) console.info("DEBUG:ConsulContext:session:locking:create:" + JSON.stringify(this.config.defaults));
		promiseArray.push(
			this.client.session.create({"node": this.locknode}).then((result) => {
				if (this.debug) console.info("DEBUG:ConsulContext:session:create:" + JSON.stringify(result));
				if (result === null) {
					throw new Error("ERROR:ConsulContext:session:create:null result");
				} else if (typeof result !== "object") {
					throw new Error("ERROR:ConsulContext:session:create:non object result for session:" + this.config.defaults.name);
				} else if (!("ID" in result)) {
					throw new Error("ERROR:ConsulContext:session:create:no ID provided for session:" + this.config.defaults.name);
				} else {
					this.sessionid = result.ID;
					if (this.debug) console.info("DEBUG:ConsulContext:session:create:success:" + this.sessionid);
					return this.sessionid;
				}
			}).catch((err) => {
				throw new Error("ERROR:ConsulContext:open:session:create:" + err);
			}).then((sessionID) => this.client.session.get({		//confirm sessionID was generated and spit out debugging if wanted
				"id": sessionID
			})).then((result) => {
				if (result === null) {
					throw new Error("ERROR:ConsulContext:session:get:null result");
				} else if (typeof result !== "object") {
					throw new Error("ERROR:ConsulContext:session:get:non object result for session:" + this.config.defaults.name);
				} else if (!("ID" in result)) {
					throw new Error("ERROR:ConsulContext:session:get:no ID provided for session:" + this.config.defaults.name);
				} else if (result.ID !== this.sessionid ) {
					throw new Error("ERROR:ConsulContext:session:sessionIDs do not match:" + result.ID + ":" + this.sessionid + ":for session:" + this.config.defaults.name);
				} else {
					if (this.debug) console.info("DEBUG:ConsulContext:session:get:success:" + JSON.stringify(result));
					return result.ID;
				}
			}).catch((err) => {
				throw new Error("ERROR:ConsulContext:open:session:get:" + err);
			}).then((sessionID) => this.client.kv.set({
				"key": 		this.prefix + "/_consulContextLock",
				"value":	"locked",
				"acquire":	sessionID
			})).then((result) => {
				if (result === null) {
					throw new Error("ERROR:ConsulContext:sendLockKV:null result");
				} else if (typeof result !== "boolean") {
					throw new Error("ERROR:ConsulContext:sendLockKV:non bool result");
				} else if (! result) {
					throw new Error("ERROR:ConsulContext:sendLockKV:false response returned");
				} else {
					return result;
				}
				return result;
			}).catch((err) => {
				throw new Error("ERROR:ConsulContext:open:session:setKVlock:" + err);
			})
		);
	}

	return Promise.all(promiseArray);
}

ConsulContext.prototype.close = function() {								//close down consul connection
	if (this.debug) console.info("DEBUG:ConsulContext:closing with settings:" + JSON.stringify(this.config));
	let promiseArray = [];
	promiseArray.push(deleteKey(this.client, this.prefix + "/_hello", this.debug));
	if (this.lock) {
		promiseArray.push(		//UNlocking
			this.client.kv.set({
				"key": 		this.prefix + "/_consulContextLock",
				"value":	"unlocked",
				"release ":	this.sessionid
			}).catch((err) => {
				throw err;
			}).then(() => this.client.session.destroy({
				"id":		this.sessionid
			})).catch((err) => {
				throw err;
			})
		)
	}
	return Promise.all(promiseArray);
	//return Promise.resolve();	//return a resolved promise that does nothing
}

ConsulContext.prototype.get = function(scope, key, callback) {				//get a value from a key
	if (this.debug) console.info("DEBUG:ConsulContext:get:scope:" + this.prefix + "/" + scope + '/' + key);
	if (! callback) throw new Error("ERROR:ConsulContext:get:synchronous get access not supported -- must guarantee Consul has the value");
	if (typeof callback !== 'function') throw new Error("Callback must be a function");

	let keypath = this.prefix + "/" + scope + '/' + key;
	let pArray = [];
	if (typeof key == "string") {
		pArray.push(fetchValue(this.client, keypath, this.debug));
	} else if (Array.isArray(key)) {
		for (var i = 0; i < key.length; i++) {
			if (this.debugmore) console.info("DEBUG:ConsulContext:get (array) " + i.toString() + " of " + key.length.toString());
			pArray.push(fetchValue(this.client, this.prefix + "/" + scope + '/' + key[i], this.debug));
		}
	} else {
		throw new Error("ERROR:ConsulContext:get:key is not an array or a string");
	}

	if (this.debug) console.info("DEBUG:ConsulContext:get:pArray has " + pArray.length.toString() + " entries");
	if (this.debug) console.info("DEBUG:ConsulContext:get:return:async");
	if (pArray.length > 1) {
		Promise.all(pArray).then((data)	=> { callback(null, data) }).catch((err) => { callback(err) });
	} else {
		pArray[0].then((data) => { callback(null, data) }).catch((err) => { callback(err) });
	}

}

ConsulContext.prototype.set = function(scope, key, value, callback) {		//set key value data, depending on input it can be multiple
	if (this.debug) console.info("DEBUG:ConsulContext:set " + this.prefix + '/' + scope + '/' + key + ":" + JSON.stringify(value));
	if (! callback) throw new Error("ERROR:ConsulContext:set:synchronous write access not supported -- must guarantee Consul takes the value");
	if (typeof callback !== 'function') throw new Error("Callback must be a function");

	let checkByteSize = (key, check) => {
		let byteLength = Buffer.from(JSON.stringify(check)).length;
		if (this.debug) console.info("DEBUG:ConsulContext:set:byteLength of value for key " + key + " = " + JSON.stringify(byteLength));
		if (byteLength > 512000) throw new Error("ERROR:ConsulContext:set:byteLength of value for key " + key + " exceeds 512000");
	};

	let values 	= []
	let keys 	= [];		//Organize our data so we know i's good going into consul
	if (typeof(key) === "string" && ! Array.isArray(value)) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:key is string and value is " + typeof(value));
		if (value) checkByteSize(key, value);
		keys.push(key);
		values.push(value);
	} else if (Array.isArray(key) && ! Array.isArray(value)) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:pushing null to all values without matching key");
		var doneIt = False;
		for (var i = 0; i < key.length; i++) {
			if (doneIt) {
				values.push(null);
			} else {
				if (value) checkByteSize(key[i], value);
				keys.push(key[i]);
				values.push(value);
				doneIt = true;
			}
		}
	} else if (typeof(key) === "string" && Array.isArray(value)) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:pushing first value " + value[0] + " onto key string " + key);
		if (value[0]) checkByteSize(key, value[0]);
		values.push(value[0]);
		keys.push(key);
	} else if (Array.isArray(key) && Array.isArray(value) && key.length === value.length) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:matching key and value array lengths");
		for (var i = 0; i < key.length; i++) {
			if (value[i]) checkByteSize(key[i], value[i]);
		}
		values = value;
		keys = key;
	} else if (Array.isArray(key) && Array.isArray(value) && key.length > value.length) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:more keys than values to setting some values to null");
		for (var i = 0; i < value.length; i++) {
			if (value[i]) {
				if (value[i]) checkByteSize(key[i], value[i]);
				keys.push(key[i]);
				values.push(value[i]);
			} else {
				keys.push(key[i]);
				values.push(null);
			}
		}
	} else if (Array.isArray(key) && Array.isArray(value) && key.length < value.length) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:more values that keys to discarding extra values");
		for (var i = 0; i < key.length; i++) {
			if (value[i]) checkByteSize(key[i], value[i]);
			keys.push(key[i]);
			values.push(value[i]);
		}
	} else {
		throw new Error("ERROR:ConsulContext:ERROR:Unknown datatype combination");
	}

	if (this.debug) console.info("DEBUG:ConsulContext:set:processing " + keys.length.toString() + " key value pairs");
	var promiseArray = [];
	var cachArray = [];
	for (var i = 0; i < keys.length; i++) {
		let key = this.prefix + "/" + scope + '/' + keys[i];
		if (this.debugmore) console.info("DEBUG:ConsulContext:set " + i.toString() + " of " + keys.length.toString() + ", " + key + ":" + values[i]);
		if (typeof(values[i]) == "undefined") {
			if (this.debug) console.info("DEBUG:ConsulContext:set:undefinedSoDelete:key:" + key);
			deleteKey(this.client, key, this.debug).resolve();	//node-red change node sets value to undefined when deleting key for some reason
		} else {
			promiseArray.push( sendKV(this.client, key, values[i], this.debug) );
		}
	}
	if (promiseArray.length > 1) {
		Promise.all(promiseArray).then((data) => { callback(null) }).catch((err) => { callback(err) });
	} else {
		promiseArray[0].then((data)	=> { callback(null) }).catch((err) => { callback(err) });
	}
}

ConsulContext.prototype.keys = function(scope, callback) {
	if (this.debug) console.info("DEBUG:ConsulContext:keys:scope:" + scope);
	if (! callback) throw new Error("ERROR:ConsulContext:keys:synchronous write access not supported -- must guarantee Consul takes the value");
	if (typeof callback !== 'function') throw new Error("Callback must be a function");
	let key = this.prefix + "/" + scope;

	fetchKeys(this.client, key, this.debug, this.debugmore)
	.then((data) => {
		let partkeys = [];
		let prefixLength = key.length + 1; //+1 is the "/"
		for (var i = 0; i < data.length; i++) {
			if (data[i] == this.prefix + "/_hello" || data[i]  == this.prefix + "/_consulContextLock") continue;
			partkeys.push( data[i].substring(prefixLength,data[i].length) );		//trim off the preamble
		}
		if (this.debug) console.info("DEBUG:ConsulContext:keys:returning:" + JSON.stringify(partkeys) + ":from:" + JSON.stringify(data));
		callback(null, partkeys);
	}).catch((err) => { callback(err) });
}

ConsulContext.prototype.delete = function(scope) {
	if (this.debug) console.info("DEBUG:ConsulContext:delete:scope:" + scope);
	let key = this.prefix + "/" + scope;
	deleteKey(this.client, key, this.debug).resolve();
}

ConsulContext.prototype.clean = function(activeNodes) {
	if (this.debug) console.info("DEBUG:ConsulContext:clean:avoidActiveNodes" + JSON.stringify(activeNodes));
	return fetchKeys(this.client, this.prefix, this.debug, this.debugmore).then(result => {
		if (this.debug) console.info("DEBUG:ConsulContext:clean:consul:" + JSON.stringify(result));
		return result;
	}).catch((err) => {
		throw err;
	}).then(result => {
		//quick function to scan the activeNodes
		let skipPath = (key) => {
			for (var i = 0; i < activeNodes.length; i++) {
				if (key.startsWith(this.prefix + "/" + activeNodes[i])) return true;
			}
			return false;
		};
		//now scan through the keys skipping any that we should leave and cleaning the rest
		var pArray = [];
		for (var i = 0; i < result.length; i++) {
			if (this.debug) console.info("DEBUG:ConsulContext:clean:checking:" + result[i]);
			if (	skipPath(result[i])								||		//skip active nodes entire tree
					result[i].startsWith(this.prefix + "/global")	||		//copied from localfilesystem built in, never clean globals
					result[i] == this.prefix + "/_hello"			||
					result[i] == this.prefix + "/_consulContextLock"
				) {
				if (this.debug) console.info("DEBUG:ConsulContext:clean:consul:skipping:" + result[i]);
				continue;
			}
			if (this.debug) console.info("DEBUG:ConsulContext:clean:consul:deleting:" + result[i]);
			pArray.push( deleteKey(this.client, result[i], this.debug) );
		}
		if (pArray.length > 0) {
			return Promise.all(pArray);
		} else {
			return Promise.resolve();
		}
	}).catch((err) => {
		throw new Error("ERROR:ConsulContext:clean:" + err);
	});
}

module.exports = function (config) {
    return new ConsulContext(config);
};



