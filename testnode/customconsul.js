module.exports = function(RED) {
    "use strict";
    function customconsul(n) {
        RED.nodes.createNode(this, n);
        var node = this;
        var context = this.context();		//node context is default
        if (n.context === "flow") context = this.context().flow;
        if (n.context === "global") context = this.context().global;
        node.on('input', function(msg) {
        	context.set(n.key, n.value, n.contextplugin, function(err) {
        		if (err) {
        			node.status({fill: "red", shape: "dot", text: err});
        		} else {
        			node.status({});
        			node.send(msg);
        		}
        	})
        });
    }
    RED.nodes.registerType("customconsul", customconsul);
}
