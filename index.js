
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
    		cache: true,			//use memory cache	--NOTE, disable only for debugging
    		debug: false			//flag to enable console debug messages
        }
	}

 Key Value store structure:

 _nrcontext/[prefix config option]
   ├── global
   │      ├── key/value
   │      ├── key/value
   ├── <id of Flow 1>
   │      ├── key/value
   │      ├── key/value
   │      └── key/value
   └── <id of Flow 2>
          ├── key/value
          ├── key/value
          └── key/value

 */

let fetchValue = (client, opts, cache, debug) => {
	if ("value" in opts) delete opts.value;
	opts.buffer = true;
	if (debug) console.info("DEBUG:ConsulContext:fetchValue:opts:" + JSON.stringify(opts));
	return client.kv.get(opts).then((result) => {
		if (result === null) 		throw new Error("ERROR:ConsulContext:fetchValue:null result");
		if (!("Value" in result)) 	throw new Error("ERROR:ConsulContext:fetchValue:noValueFound");
		return result.Value;
	}).catch((err) => {
		if ("statusCode" in err && err.statusCode == 404) {
			if (debug) console.info("DEBUG:ConsulContext:fetchValue:nullresponse");
			return(null);
		} else {
			throw err;
		}
	}).then((result) => {
		if (cache && !(opts.key in cache)) cache[opts.key] = result;
		if (debug) console.info("DEBUG:ConsulContext:fetchValue:result:" + result);
		try {
			return JSON.parse(result.toString());
		} catch (e) {
			throw new Error("ERROR:ConsulContext:fetchValue:failed to return parsed value:" + e);
		}
	}).catch((err) => {
		throw err;
	});
}

let getFromCache = (key, cache, debug) => {
	return new Promise((resolve, reject) => {
		if (cache && key in cache) {
			if (debug) console.info("DEBUG:ConsulContext:getFromCache:key:" + key);
			try {
				let value = JSON.parse(cache[key].toString());
				if (debug) console.info("DEBUG:ConsulContext:getFromCache:value:" + value);
				resolve(value);
			} catch (e) {
				reject("ERROR:ConsulContext:getFromCache:unable to parse value for key:" + key);
			}
		} else {
			reject("ERROR:ConsulContext:getFromCache:key not found in cache:" + key);
		}
	});
}

let sendKV = (client, opts, cache, debug) => {
	if (debug) console.info("DEBUG:ConsulContext:sendKV:opts:" + JSON.stringify(opts));
	opts.value = Buffer.from(JSON.stringify(opts.value));
	return client.kv.set(opts).then((result) => {
		if (result === null) {
			throw new Error("ERROR:ConsulContext:sendKV:null result for key:" + opts.key);
		} else if (typeof result !== "boolean") {
			throw new Error("ERROR:ConsulContext:sendKV:none bool result for key:" + opts.key);
		} else if (! result) {
			throw new Error("ERROR:ConsulContext:sendKV:false response retured from consul for key:" + opts.key + ":" + result);
		} else {
			return result;
		}
	}).catch((err) => {
		throw err;
	}).then((result) => {
		if (cache) cache[opts.key] = opts.value;
		return result;
	}).catch((err) => {
		throw err;
	});
}

let fetchKeys = (client, opts, debug) => {
	if ("value" in opts) delete opts.value;
	if (debug) console.info("DEBUG:ConsulContext:fetchKeys:opts:" + JSON.stringify(opts));
	return client.kv.keys(opts).then((result) => {
		if (result == null) {
			if (debug) console.info("DEBUG:ConsulContext:fetchKeys:nullOrUndefinedResponse");
			return([]);
		} else if (! Array.isArray(result)) {
			throw new Error("ERROR:ConsulContext:Error:Keys returned a non array value:" + JSON.stringify(result));
		} else {
			return result;
		}
	}).catch((err) => {
		if ("statusCode" in err && err.statusCode == 404) {
			if (debug) console.info("DEBUG:ConsulContext:fetchKeys:no keys found at " + opts.key);
			return([]);
		}
		throw err;
	});
}

let deleteKey = (client, opts, debug) => {
	if ("value" in opts) delete opts.value;
	opts.recurse = true;
	if (debug) console.info("DEBUG:ConsulContext:deleteKey:opts:" + JSON.stringify(opts));
	return client.kv.del(opts).then((result) => {
		return result;
	}).catch((err) => {
		throw err;
	});
}

//Construct and override
let ConsulContext = function(config) {
	this.debug 	= false;
	this.opts 	= {};				//standard options sent in all consul API calls
	if ("token" in config) {		//ACL token for all API calls
		this.opts.token = config.token;
		delete(config.token);
	}
	this.opts.consistent = true;	//request strong consistency from consul
	if ("consistent" in config) {	//but can be overridden
		this.opts.consistent = config.consistent;
		delete(config.datacenter);
	}
	if ("datacenter" in config) {	//Sets the consul datacenter value in each API call (if none consul default = local)
		this.opts.dc = config.datacenter;
		delete(config.datacenter);
	}
	if ("timeout" in config) {		//Sets the API timeouts in ms
		this.opts.timeout = config.timeout;
		delete(config.datacenter);
	}
	this.cache = {};				//only turn off the cache for debugging!
	if ("cache" in config) {		//Flag on whether to use the mem cache or not (hidden, default true)
		if (! config.cache) this.cache = null;
		delete(config.cache);
	}
	this.prefix = "_nrcontext";
	if ("prefix" in config) {		//will prefix the KV pairs with _nrcontext/[config_prefix] so that flows are uniquly handled
		this.prefix = "_nrcontext/" + config.prefix;
		delete(config.prefix);
	}
	if ("debug" in config) {		//enable debugging to console
		this.debug = true;
		delete(config.debug);
	}
	config.promisify = true;		//enforces consul to return promises rather than callbacks which we then just feed back into node-red context API
	this.config = config;
	this.client = null;
	if (this.debug) console.info("Constructing ConsulContext with settings:" + JSON.stringify(this));
}

ConsulContext.prototype.open = function() {
	if (this.debug) console.info("DEBUG:ConsulContext:initialing with settings:" + JSON.stringify(this.config));
	this.client = require('consul')(this.config);

	//Test functionality of all the consul calls before allowing node-red to ok this context plugin
	var promiseArray 	= [];
	let opts 			= Object.assign({}, this.opts);
	opts.key 			= this.prefix + "/hello";
	opts.value 			= "world";
	promiseArray.push(
		sendKV(this.client, opts, this.cache, this.debug)
			.then(result => {
				if (this.debug) console.info("DEBUG:ConsulContext:sendKV_test:success:" + JSON.stringify(result));
			}).catch((err) => {
				throw err;
			}).then(() => fetchValue(this.client, opts, this.cache, this.debug))
			.then(result => {
				if (! result) throw new Error("ERROR:ConsulContext:open:fetchValue_test:no result");
				if (result !== "world") throw new Error("ERROR:ConsulContext:open:fetchValue_test:" + JSON.stringify(result) + " does not match expected:\"world\"");
				if (this.debug) console.info("DEBUG:ConsulContext:fetchValue_test:success:" + JSON.stringify(result));
			}).catch((err) => {
				throw err;
		})
	);
	let opts2 		= Object.assign({}, this.opts);
	opts2.key 		= this.prefix + "/deleteme";
	opts2.value 	= true;
	let opts3 		= Object.assign({}, this.opts);
	opts3.key		= this.prefix;
	promiseArray.push(
		sendKV(this.client, opts2, this.cache, this.debug)
			.then(result => {
				if (this.debug) console.info("DEBUG:ConsulContext:sendKV_test2:success:" + JSON.stringify(result));
			}).catch((err) => {
				throw err;
			}).then(() => fetchValue(this.client, opts2, this.cache, this.debug))
			.then(result => {
				if (! result) throw new Error("ERROR:ConsulContext:open:fetchValue_test2:no result");
				if (typeof result !== "boolean") throw new Error("ERROR:ConsulContext:open:fetchValue_test2:" + JSON.stringify(result)) + " does not match expected:\"delete failed\"}";
				if (this.debug) console.info("DEBUG:ConsulContext:fetchValue_test2:success:" + JSON.stringify(result));
			}).catch((err) => {
				throw err;
			}).then(() => fetchKeys(this.client, opts3, this.debug))
			.then(result => {
				if (! result) throw new Error("ERROR:ConsulContext:open:fetchKeys_test:no result");
				let testok = false;
				for (var i = 0; i < result.length; i++) {
					if (this.debug) console.info("DEBUG:ConsulContext:fetchKeys_test:checking key:" + result[i]);
					if (result[i].endsWith("deleteme")) testok = true;
				}
				if (! testok) throw new Error("ERROR:ConsulContext:open:fetchKeys_test:deleteme:not found in results:" + JSON.stringify(result));
				if (this.debug) console.info("DEBUG:ConsulContext:fetchKeys_test:success:" + JSON.stringify(result));
			}).catch((err) => {
				throw err;
			}).then(() => deleteKey(this.client, opts2, this.debug))
			.then(result => {
				if (this.debug) console.info("DEBUG:ConsulContext:deleteKey_test:success:" + JSON.stringify(result));
			}).catch((err) => {
				throw err;
			}).then(() => fetchKeys(this.client, opts3, this.debug))
			.then(result => {
				if (! result) throw new Error("ERROR:ConsulContext:open:fetchKeys_test2:no result");
				let testok = true;
				for (var i = 0; i < result.length; i++) {
					if (this.debug) console.info("DEBUG:ConsulContext:fetchKeys_test2:checking key:" + result[i]);
					if (result[i].endsWith("deleteme")) testok = false;
				}
				if (! testok) throw new Error("ERROR:ConsulContext:open:fetchKeys_test2:deleteme:still found in results:" + JSON.stringify(result));
				if (this.debug) console.info("DEBUG:ConsulContext:fetchKeys_test2:success:" + JSON.stringify(result));
			}).catch((err) => {
				throw err;
		})
	);
	return Promise.all(promiseArray);
}

ConsulContext.prototype.close = function() {								//close down consul connection
	if (this.debug) console.info("DEBUG:ConsulContext:closing with settings:" + JSON.stringify(this.config));
	this.cache = {};
	return Promise.resolve();	//return a resolved promise that does nothing because we have nothing to do
}

ConsulContext.prototype.get = function(scope, key, callback) {				//get a value from a key
	if (this.debug) console.info("DEBUG:ConsulContext:get " + scope + '/' + JSON.stringify(key));
	if (callback && typeof callback !== 'function') throw new Error("Callback must be a function");
	if (! callback) throw new Error("synchronous access not supported");

	let pArray = [];
	let opts = Object.assign({}, this.opts);
	opts.key = this.prefix + "/" + scope + '/' + key;

	if (typeof key == "string" && this.cache && opts.key in this.cache) {
		pArray.push(getFromCache(opts.key, this.cache, this.debug));
	} else if (typeof key == "string") {
		pArray.push(fetchValue(this.client, opts, this.cache, this.debug));
	} else if (Array.isArray(key)) {
		let cached = false;
		for (var i = 0; i < key.length; i++) {
			let tmpopts = Object.assign({}, this.opts);
			tmpopts.key = this.prefix + "/" + scope + '/' + key[i];
			if (this.debug) console.info("DEBUG:ConsulContext:get (array) " + i.toString() + " of " + key.length.toString());
			if (this.cache && tmpopts.key in this.cache) {
				cached = true;
				pArray.push(getFromCache(opts.key, this.cache, this.debug));
			} else {
				if (cached) throw new Error("ERROR:ConsulContext:get:key list was part cached, key not cached = " + key[i]);
				pArray.push(fetchValue(this.client, tmpopts, this.cache, this.debug));
			}
		}
	} else {
		throw new Error("ERROR:ConsulContext:get:key is not an array or a string");
	}

	if (this.debug) console.info("DEBUG:ConsulContext:get:pArray has " + pArray.length.toString() + " entries");
	if (pArray.length > 1) {
		return Promise.all(pArray)
			.then((data) 	=> { callback(null, data) })
			.catch((err) 	=> { callback(err) });
	} else {
		return pArray[0]
			.then((data) 	=> { callback(null, data) })
			.catch((err) 	=> { callback(err) });
	}
}

ConsulContext.prototype.set = function(scope, key, value, callback) {		//set key value data, depending on input it can be multiple
	if (this.debug) console.info("DEBUG:ConsulContext:set " + scope + '/' + JSON.stringify(key) + ":" + JSON.stringify(value));
	if (callback && typeof callback !== 'function') throw new Error("Callback must be a function");
	if (! callback) throw new Error("synchronous access not supported");

	let checkByteSize = (key, check) => {
		let byteLength = Buffer.from(JSON.stringify(check)).length;
		if (this.debug) console.info("DEBUG:ConsulContext:set:byteLength of value for key " + key + " = " + JSON.stringify(byteLength));
		if (byteLength > 512000) throw new Error("ERROR:ConsulContext:set:byteLength of value for key " + key + " exceeds 512000");
	};

	let values 	= []
	let keys 	= [];		//Organize our data so we know i's good going into consul
	if (typeof(key) === "string" && ! Array.isArray(value)) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:key and value are both strings");
		checkByteSize(key, value);
		keys.push(key);
		values.push(value);
	} else if (Array.isArray(key) && ! Array.isArray(value)) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:pushing null to all values without matching key");
		var doneIt = False;
		for (var i = 0; i < key.length; i++) {
			if (doneIt) {
				values.push(null);
			} else {
				checkByteSize(key[i], value);
				keys.push(key[i]);
				values.push(value);
				doneIt = true;
			}
		}
	} else if (typeof(key) === "string" && Array.isArray(value)) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:pushing first value " + value[0] + " onto key string " + key);
		checkByteSize(key, value[0]);
		values.push(value[0]);
		keys.push(key);
	} else if (Array.isArray(key) && Array.isArray(value) && key.length === value.length) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:matching key and value array lengths");
		for (var i = 0; i < key.length; i++) {
			checkByteSize(key[i], value[i]);
		}
		values = value;
		keys = key;
	} else if (Array.isArray(key) && Array.isArray(value) && key.length > value.length) {
		if (this.debug) console.info("DEBUG:ConsulContext:set:more keys than values to setting some values to null");
		for (var i = 0; i < value.length; i++) {
			if (value[i]) {
				checkByteSize(key[i], value[i]);
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
			checkByteSize(key[i], value[i]);
			keys.push(key[i]);
			values.push(value[i]);
		}
	} else {
		throw new Error("ERROR:ConsulContext:ERROR:Unknown datatype combination");
	}

	if (this.debug) console.info("DEBUG:ConsulContext:set:processing " + keys.length.toString() + " key value pairs");
	var promiseArray = [];
	for (var i = 0; i < keys.length; i++) {
		let opts = Object.assign({}, this.opts);
		opts.key = this.prefix + "/" + scope + '/' + keys[i];
		opts.value = values[i];
		if (this.debug) console.info("DEBUG:ConsulContext:set " + i.toString() + " of " + keys.length.toString() + ", " + opts.key + ":" + opts.value);
		promiseArray.push( sendKV(this.client, opts, this.cache, this.debug) );
	}
	if (this.debug && this.cache) console.info("DEBUG:ConsulContext:set:cache:" + JSON.stringify(this.cache));
	if (promiseArray.length > 1) {
		return Promise.all(promiseArray)
			.then((data) 	=> { callback(null) })
			.catch((err) 	=> { callback(err) });
	} else {
		return promiseArray[0]
			.then((data) 	=> { callback(null) })
			.catch((err) 	=> { callback(err) });
	}
}

ConsulContext.prototype.keys = function(scope, callback) {
	if (this.debug) console.info("DEBUG:ConsulContext:keys:scope:" + scope);
	if (callback && typeof callback !== 'function') throw new Error("Callback must be a function");
	if (! callback) throw new Error("synchronous access not supported");
	if (this.cache && this.prefix + "/" + scope in this.cache) {
		let allkeys = Object.keys(this.cache);
		let allInScopeKeys = [];
		for (var i = 0; i < allkeys.length; i++) {
			if (allkeys[i].startsWith(scope)) allInScopeKeys.push(allkeys[i]);
		}
		return allkeys;
	} else {
		let opts = Object.assign({}, this.opts);
		opts.key = this.prefix + "/" + scope;
		return fetchKeys(this.client, opts, this.debug)
			.then((data) 	=> { callback(null, data) })
			.catch((err)	=> { callback(err) });
	}
}

ConsulContext.prototype.delete = function(scope) {
	if (this.debug) console.info("DEBUG:ConsulContext:delete in scope " + scope);
	let cacheKey = this.prefix + "/" + scope;
	if (this.cache && cacheKey in this.cache) delete this.cache[cacheKey];
	let opts = Object.assign({}, this.opts);
	opts.key = this.prefix + "/" + scope;
	return deleteKey(this.client, opts, this.debug);
}

ConsulContext.prototype.clean = function(activeNodes) {
	if (this.debug) console.info("DEBUG:ConsulContext:clean:avoidActiveNodes" + JSON.stringify(activeNodes));
	let opts = Object.assign({}, this.opts);
	opts.key = this.prefix;

	//Clean the cache
	if (this.cache) {
		if (this.debug) console.info("DEBUG:ConsulContext:clean:cache:" + JSON.stringify(this.cache));
		let skipCachedPath = (key) => {
			let skipIt = false;
			for (var i = 0; i < activeNodes.length; i++) {
				if (key.startsWith(this.prefix + "/" + activeNodes[i])) skipIt = true;
			}
			return skipIt;
		};
		let cacheKeys = Object.keys(this.cache);
		for (var i = 0; i < cacheKeys.length; i++) {
			if (skipCachedPath(cacheKeys[i]) || cacheKeys[i].startsWith("global")) continue;
			if (this.debug) console.info("DEBUG:ConsulContext:cleaned:delete:" + cacheKeys[i]);
			delete this.cache[ cacheKeys[i] ];
		}
	}

	//... and now clean Consul
	return fetchKeys(this.client, opts, this.debug)
		.then(result => {
			if (this.debug) console.info("DEBUG:ConsulContext:clean:consul:" + JSON.stringify(result));
			return result;
		}).catch((err) => {
			throw err;
		}).then(result => {
			//quick function to scan the activeNodes
			let skipPath = (key) => {
				let skipIt = false;
				for (var i = 0; i < activeNodes.length; i++) {
					if (key.startsWith(this.prefix + "/" + activeNodes[i])) {
						skipIt = true;
						if (this.debug) console.info("DEBUG:ConsulContext:clean:skipPath:" + key + " starts with " + this.prefix + "/" + activeNodes[i]);
					}
				}
				return skipIt;
			};
			//now scan through the keys skipping any that we should leave and cleaning the rest
			var pArray = [];
			for (var i = 0; i < result.length; i++) {
				if (this.debug) console.info("DEBUG:ConsulContext:clean:checking" + result[i]);
				if (	skipPath(result[i])								||		//skip active nodes entire tree
						result[i].startsWith(this.prefix + "/global")	||		//copied from localfilesystem built in, never clean globals
						result[i] == this.prefix + "/hello"
					) {
					if (this.debug) console.info("DEBUG:ConsulContext:clean:consul:skipping" + result[i]);
					continue;
				}
				let tmpopts = Object.assign({}, this.opts);
				tmpopts.key = result[i];
				if (this.debug) console.info("DEBUG:ConsulContext:clean:consul:deleting " + tmpopts.key);
				pArray.push( deleteKey(this.client, tmpopts, this.debug) );
			}
			if (pArray.length > 0) {
				return Promise.all(pArray);
			} else {
				return Promise.resolve();
			}
		}).catch((err) => {
			throw err;
	});
}

module.exports = function (config) {
    return new ConsulContext(config);
};



