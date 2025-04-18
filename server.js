
import cytoscape from 'cytoscape';
import bodyParser from 'body-parser';
import dagre from 'cytoscape-dagre';
import buildHistoryGraph from './buildHistoryGraph.js';

import express from 'express';
import { createServer} from 'http';

import { WebSocketServer } from 'ws';

let peers = {

}

let meta;
let existingHistoryNodeIDs = new Set()

let graphStyle = 'MANUAL_DAG'
let graphLayouts = {
    // https://github.com/dagrejs/dagre/wiki#configuring-the-layout
    DAG: {
        name: 'dagre',
        rankDir: 'BT', // Set the graph direction to top-to-bottom
        nodeSep: 300, // Optional: adjust node separation
        edgeSep: 100, // Optional: adjust edge separation
        rankSep: 50, // Optional: adjust rank separation for vertical spacing,
        fit: false,
        padding: 30
    },
    // wrote this specifically to fix the ordering of branches being changed on the fly in the dagre package version (above)
    MANUAL_DAG: {
        name: 'preset',
        fit: false,
        padding: 30,
        animate: false
    },
    breadthfirst: {
        name: 'breadthfirst',

        fit: false, // whether to fit the viewport to the graph
        directed: true, // whether the tree is directed downwards (or edges can point in any direction if false)
        padding: 30, // padding on fit
        circle: false, // put depths in concentric circles if true, put depths top down if false
        grid: false, // whether to create an even grid into which the DAG is placed (circle:false only)
        spacingFactor: 1.75, // positive spacing factor, larger => more space between nodes (N.B. n/a if causes overlap)
        boundingBox: undefined, // constrain layout bounds; { x1, y1, x2, y2 } or { x1, y1, w, h }
        avoidOverlap: true, // prevents node overlap, may overflow boundingBox if not enough space
        nodeDimensionsIncludeLabels: false, // Excludes the label when calculating node bounding boxes for the layout algorithm
        roots: undefined, // the roots of the trees
        depthSort: undefined, // a sorting function to order nodes at equal depth. e.g. function(a, b){ return a.data('weight') - b.data('weight') }
        animate: false, // whether to transition the node positions
        animationDuration: 500, // duration of animation in ms if enabled
        animationEasing: undefined, // easing of animation if enabled,
        animateFilter: function ( node, i ){ return true; }, // a function that determines whether the node should be animated.  All nodes animated by default on animate enabled.  Non-animated nodes are positioned immediately when the layout starts
        ready: undefined, // callback on layoutready
        stop: undefined, // callback on layoutstop
        transform: function (node, position ){ return position; } // transform a given node position. Useful for changing flow direction in discrete layouts

    }


}




// Create Cytoscape instance
cytoscape.use( dagre );
const historyDAG_cy = cytoscape({
    headless: true, // Enable headless mode for server-side rendering

    // container: document.getElementById('docHistory-cy'),
    elements: [],
//   zoom: parseFloat(localStorage.getItem('docHistoryCy_Zoom')) || 1., 
    // viewport: {
    //     zoom: parseFloat(localStorage.getItem('docHistoryCy_Zoom')) || 1.
    // },
    boxSelectionEnabled: true,
    selectionType: "additive",
    zoomingEnabled: false,
    
    layout: graphLayouts[graphStyle],  
    style: [
        {
            selector: 'node',
            style: {
                'background-color': 'data(color)', // based on edit type
                'label': 'data(label)', // Use the custom label attribute
                'width': 30,
                'height': 30,
                'color': '#000',            // Label text color
                'text-valign': 'center',    // Vertically center the label
                'text-halign': 'right',      // Horizontally align label to the left of the node
                'text-margin-x': 15, // 
                'text-wrap': 'wrap',
                'text-max-width': 120
                // 'text-margin-y': 15, // move the label down a little to make space for branch edges
                // 'shape': 'data(shape)' // set this for accessibility (colour blindness)
            }
        
        },
        {
            selector: 'edge',
            style: {
                'width': 6,
                'line-color': '#ccc',
                'target-arrow-shape': 'triangle',
                'target-arrow-color': '#ccc',
                'target-arrow-width': 20, // Size of the target endpoint shape
                'curve-style': 'bezier' // Use a Bezier curve to help arrows render more clearly

            }
        },
        {
            selector: 'node.highlighted',
            style: {
                'border-color': '#228B22', // Highlight color
                'border-width': 15,
                'shape': 'rectangle'
            }
        },
        {
            selector: '.sequencerSelectionBox',
            style: {
                'border-color': 'blue', // Highlight color
                'border-width': 4,
                'shape': 'rectangle',
                'background-color': 'white',
                "background-opacity": 0,
                "width": 50,
                "height": 'data(height)',
                "label": '',
                "z-index": -1

            }
        },
        {
            selector: '.sequencerSelectionBox-handle',
            style: {
                // 'border-color': 'blue', // Highlight color
                'border-width': 0,
                'shape': 'ellipse',
                'background-color': 'blue',
                // "background-opacity": 0,
                "width": '10',
                "height": '10',
                "label": '',
                "z-index": 10

            }
        },
        {
            selector: '.sequencerNode',
            style: {
                'border-color': '#000000',  // Change to your desired color
                'border-width': '8px',
                'border-style': 'solid'


            }
        },
        {
            selector: '.sequencerEdge',
            style: {
                // 'border-color': 'blue', // Highlight color
                'line-color': 'blue',
                "width": '10',
                'target-arrow-color': 'blue'


            }
        },
    ]
});

// A simple in-memory store for rooms
const rooms = {};

// Helper function to assign a client to a room
function assignRoom(ws, desiredRoom) {
    // If a specific room is provided
    if (desiredRoom) {
      // If the desired room already exists
      if (rooms[desiredRoom]) {
        // If room is not full, assign the client there.
        if (rooms[desiredRoom].length < 2) {
          rooms[desiredRoom].push(ws);
          return desiredRoom;
        } else {
          console.log(`Desired room ${desiredRoom} is full. Falling back to default assignment.`);
        }
      } else {
        // Create the room if it doesn't exist.
        rooms[desiredRoom] = [ws];
        return desiredRoom;
      }
    }
    
    // Fallback: Loop over existing rooms and join one that has less than 2 clients.
    for (const room in rooms) {
      if (rooms[room].length < 2) {
        rooms[room].push(ws);
        return room;
      }
    }
    
    // If no room is available, create a new one with a default naming scheme.
    const newRoom = `room${Object.keys(rooms).length + 1}`;
    rooms[newRoom] = [ws];
    return newRoom;
  }

const PORT = process.env.PORT || 3001;

// Create an Express app (Only for handling basic HTTP requests)
const app = express();

// Serve static frontend files from Vite's `dist` folder
app.use(express.static('dist'));

// Create an HTTP server and attach WebSocket
const server = createServer(app, (req, res)=>{
    res.writeHead(200);
    res.end('WebRTC signaling server is running\n');
});
// Create a WebSocket server that only upgrades `/ws` requests
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    console.log('🚀 WebSocket upgrade request received');
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  
let numClients = 0
// Handle client connections
wss.on('connection', (ws, req) => {
    numClients++

    const clientIp = req.socket.remoteAddress;
    console.log(`New connection from ${clientIp}`);
    console.log(`Number of clients: ${numClients}`)
    // Handle messages received from clients
    ws.on('message', (message) => {
       
        let msg = JSON.parse(message)

        switch(msg.cmd){
            case 'updateGraph':
                meta = msg.meta
                updateHistoryGraph(ws, meta, msg.docHistoryGraphStyling)
            break

            case 'clearHistoryGraph':
                historyDAG_cy.elements().remove();
                if(existingHistoryNodeIDs){
                    existingHistoryNodeIDs.clear()
                }
                historyDAG_cy.layout(graphLayouts[graphStyle]).run()
            break

            case 'collapseNodes':

            break

            case 'expandNodes':

            break
            case 'joinRoom':
                // Assign the connecting client to a room
                const room = assignRoom(ws, msg.room);
                ws.room = room;
                ws.peerID = msg.peerID
                console.log(`New client assigned to ${room}`);
                // update all lobby pages
                wss.clients.forEach((client) => {
                    if (client !== ws && client.lobby === true) {
                        sendRooms(client)
                    }
                });
            break
            case 'newPeer':
                // Convert the incoming message to a string if it’s a Buffer.
                const payload = Buffer.isBuffer(message) ? message.toString() : message;
                // peers[msg.peerID] = {}

               
                // Relay the message to the other client in the same room (if exists)
                // Use ws.room (assigned in 'joinRoom') to determine the correct room.
                const clientRoom = ws.room;
                if (clientRoom && rooms[clientRoom]) {
                rooms[clientRoom].forEach(client => {
                    if (client !== ws && client.readyState === ws.OPEN) {
                    client.send(JSON.stringify({
                        cmd: 'newPeer',
                        msg: payload
                    }), { binary: false });
                    }
                });
                } else {
                console.error('Client not assigned to any room');
                }

                
 
            break

            case 'getRooms': 
                ws.lobby = true
                // Build an array of active rooms.
                sendRooms(ws)
            break;
              
            
            default: console.log('no switch case exists for msg:', message)
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log('Client disconnected');
        numClients--
        console.log('number of clients:', numClients)
        if (ws.room && rooms[ws.room]) {
            // Remove the client from the room
            rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);
            // Clean up the room if empty
            if (rooms[ws.room].length === 0) {
              delete rooms[ws.room];
            }
            // update all lobby clients
            wss.clients.forEach((client) => {
                if (client.lobby === true) {
                    sendRooms(client)
                }
            });
        }

    });

    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`✅ WebSocket server running on ws://localhost:${PORT}`);
});

function sendRooms(ws){
    const activeRooms = [];
    for (const roomName in rooms) {
        // Only include rooms with at least one peer.
        if (rooms[roomName].length > 0) {
        const roomInfo = {
            room: roomName,
            peer1: rooms[roomName][0].peerID || null,
            peer2: rooms[roomName].length > 1 ? rooms[roomName][1].peerID || null : null
        };
        activeRooms.push(roomInfo);
        }
    }
    // Send the room info back to the client that requested it.
    ws.send(JSON.stringify({
        cmd: 'roomsInfo',
        rooms: activeRooms
    }));
}

function updateHistoryGraph(ws, meta, docHistoryGraphStyling){

    if (!existingHistoryNodeIDs || existingHistoryNodeIDs.size === 0){
        existingHistoryNodeIDs = new Set(historyDAG_cy.nodes().map(node => node.id()));
    }


    const { nodes, edges, historyNodes } = buildHistoryGraph(
        meta,
        existingHistoryNodeIDs,
        docHistoryGraphStyling
    );
    // dumb hack for weird bug where the parent prop in each node was coming out undefined despite existing in the return statement of buildHistoryGraph
    const stringed = JSON.parse(JSON.stringify(nodes, null, 2))
    // Run the layout and get the rendered graph
    // historyDAG_cy.layout(layout).run();
    if(nodes.length > 0){
        historyDAG_cy.add(stringed);

    }
    if(edges.length > 0){
        historyDAG_cy.add(edges);

    }
    existingHistoryNodeIDs = historyNodes

    historyDAG_cy.layout(graphLayouts[graphStyle]).run();

    // Send the graph JSON back to the client
    const graphJSON = historyDAG_cy.json();

    ws.send(JSON.stringify({
        cmd: "historyGraphRenderUpdate", 
        data: graphJSON
    }))
}

// Collapsing nodes into a parent node
function collapseNodes(cy, nodeIds, collapsedNodeId) {
    // Add the parent (collapsed) node
    cy.add({
        group: 'nodes',
        data: {
            id: collapsedNodeId,
            label: 'Collapsed Node'
        }
    });

    // Update the parent of the selected nodes
    nodeIds.forEach((nodeId) => {
        const node = cy.getElementById(nodeId);
        node.move({ parent: collapsedNodeId });
    });

    // Optionally hide the child nodes to simulate collapsing
    cy.$(`#${collapsedNodeId}`).children().hide();
}

// Expanding the collapsed node
function expandNodes(cy, collapsedNodeId) {
    // Show the child nodes
    cy.$(`#${collapsedNodeId}`).children().show();

    // Optionally remove the parent node
    cy.remove(cy.getElementById(collapsedNodeId));
}
