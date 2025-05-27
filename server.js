
import cytoscape from 'cytoscape';
import bodyParser from 'body-parser';
import dagre from 'cytoscape-dagre';
import buildHistoryGraph from './buildHistoryGraph.js';

import express from 'express';
import { createServer} from 'http';

import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
dotenv.config();
import { Pool } from 'pg';


// const pool = new Pool({
//     connectionString: 'postgresql://localhost:5432/forkingpaths',
//     ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
// });


const pool = new Pool({
  connectionString:
    process.env.NODE_ENV === 'production'
      ? process.env.DATABASE_URL
      : 'postgresql://localhost:5432/forkingpaths',
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});


pool.query('SELECT current_database(), current_user, current_schema()')
  .then(res => console.log('🔍 DB Connection:', res.rows[0]))
  .catch(err => console.error('❌ DB info error:', err));


import patchHistoryRouter from './patchHistoryStorage.js';
import synthRouter from './synthFiles.js';

let peers = {

}

let patchHistory;
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

app.use(express.json({ limit: '10mb' })); // for parsing JSON bodies

// 
// app.use('/api/patchHistories', patchHistoryRouter);
// app.use('/api/synthFiles', synthRouter);


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

    // send all synth templates to client:
    getSynthTemplates(ws);

    // send all patch histories tags
    getPatchHistories(ws)


    // Handle messages received from clients
    ws.on('message', (message) => {
       
        let msg = JSON.parse(message)

        switch(msg.cmd){
            case 'newPatchHistory':

                (async () => {
                    try {
                        const {
                            name,
                            authors,
                            description,
                            modules,
                            synth_template,
                            patch_binary,       // should be sent as base64 from the client
                            forked_from_id,     // may be null if this is the root
                            
                        } = msg.data;

                        // Decode base64 patch binary from client
                        const binaryBuffer = Buffer.from(patch_binary, 'base64');

                        const result = await pool.query(
                            `INSERT INTO patch_histories
                            (name, authors, description, modules, synth_template, patch_binary, forked_from_id, created_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, now())
                            RETURNING id, forked_from_id, tags, description, name`,
                            [name, authors, description, modules, synth_template, binaryBuffer, forked_from_id]
                        );
                        
                        
                        let message = JSON.stringify({
                            cmd: 'newPatchHistoryDatabaseID',
                            success: true,
                            patchHistoryId: result.rows[0].id,
                            name: result.rows[0].name,
                            forked_from_id: result.rows[0].forked_from_id,
                            tags: result.rows[0].tags,
                            description: result.rows[0].description,
                        })

                       
                        

                        await getUpdatedHistories(ws)

                        ws.send(message);

                    } catch (err) {
                        console.error('❌ DB error (savePatchHistory):', err);
                        ws.send(JSON.stringify({
                            cmd: 'savePatchHistoryResponse',
                            success: false,
                            error: err.message
                        }));
                    }
                })();

            break;

            case 'newFork':

              (async () => {
                try {
                    const result = await pool.query(
                    `INSERT INTO patch_histories (
                        name,
                        authors,
                        description,
                        tags,
                        modules,
                        synth_template,
                        patch_binary,
                        forked_from_id,
                        created_at
                    )
                    SELECT
                        name,
                        authors,
                        description,
                        tags,
                        modules,
                        synth_template,
                        patch_binary,
                        id,             -- original id becomes forked_from_id
                        now()
                    FROM patch_histories
                    WHERE id = $1
                    RETURNING id;`,
                    [msg.data.forked_from_id]
                    );

                    // ✅ Send back the new fork's id so the client can load or track it
                    ws.send(JSON.stringify({
                        cmd: 'newFork',
                        success: true,
                        newId: result.rows[0].id
                    }));

                    // getUpdatedHistories(ws)

                } catch (err) {
                    console.error('❌ DB error (newFork):', err);
                    ws.send(JSON.stringify({
                    cmd: 'newFork',
                    success: false,
                    error: err.message
                    }));
                }
                })();


            break;


            case 'getPatchHistory':
                
                (async () => {
                    try {
                        const result = await pool.query(
                            `SELECT * FROM patch_histories WHERE id = $1`,
                            [msg.id]
                        );
                    
                        if (result.rows.length === 0) {
                            ws.send(JSON.stringify({
                                cmd: 'patchHistoryNotFound',
                                id: msg.id
                            }));
                        } else {
                            ws.send(JSON.stringify({
                                cmd: 'retrievedPatchHistory',
                                data: result.rows[0]
                            }));
                        }
                    } catch (err) {
                        console.error('❌ DB error (getPatchHistoryById):', err);
                        ws.send(JSON.stringify({
                            cmd: 'patchHistoryLoaded',
                            error: err.message
                        }));
                    }
                })();
            break


            case 'saveSynth':
                
                (async () => {
                    try {

                        const { name, author, description, tags, synth_json } = msg.data;
                
                        const result = await pool.query(
                            `INSERT INTO synth_templates
                            (name, author, description, tags, created_at, synth_json)
                            VALUES ($1, $2, $3, $4, now(), $5)
                            RETURNING id`,
                            [name, author, description, tags, synth_json]
                        );
                
                        ws.send(JSON.stringify({
                            cmd: 'saveSynthTemplateResponse',
                            success: true,
                            synthFileId: result.rows[0].id
                        }));

                        wss.clients.forEach((client) => {
                            getSynthTemplates(client);
                        });
                        } catch (err) {
                        console.error('❌ DB error:', err);
                        ws.send(JSON.stringify({
                            cmd: 'saveSynthTemplateResponse',
                            success: false,
                            error: err.message
                        }));
                    }
                })(); // <-- IIFE to allow await

            break

            case 'updatePatchHistoryEntry':


                (async () => {
                    try {
                    const { id, patch_binary, authors, forked_from_id } = msg.data;

                    // Decode base64 patch binary from client
                    const binaryBuffer = Buffer.from(patch_binary, 'base64');
                    
                    const result = await pool.query(
                        `UPDATE patch_histories
                        SET patch_binary = $1,
                            authors = $2,
                            forked_from_id = $3
                        WHERE id = $4`,
                        [binaryBuffer, authors, forked_from_id, id]
                    );

                    getUpdatedHistories(ws)

                    } catch (err) {
                    console.error('❌ DB error (updatePatcHistory):', err);
                    ws.send(JSON.stringify({
                        cmd: 'updatePatchHistoryResponse',
                        success: false,
                        error: err.message
                    }));
                    }
                })();
            break

            case 'updatePatchHistoryMetadata':


                (async () => {
          
                    try {
                    const { id, name, description, tags } = msg.data;

                    const cleanTags = Array.isArray(tags)
                    ? tags.map(t => t.trim()).filter(t => t.length > 0)
                    : [];

                    const result = await pool.query(
                        `UPDATE patch_histories
                        SET name = $1,
                            description = $2,
                            tags = $3
                        WHERE id = $4`,
                        [name, description, cleanTags, id]
                    );

                    getUpdatedHistories(ws)

                    } catch (err) {
                    console.error('❌ DB error (updatePatchMetadata):', err);
                    ws.send(JSON.stringify({
                        cmd: 'updatePatchHistoryResponse',
                        success: false,
                        error: err.message
                    }));
                    }
                })();
            break

            case 'getSynthFile':
                (async () => {
                    try {
                        const result = await pool.query(
                            `SELECT * FROM synth_templates WHERE id = $1`,
                            [msg.id]
                        );
                    
                        if (result.rows.length === 0) {
                            ws.send(JSON.stringify({
                            cmd: 'synthTemplateNotFound',
                            id: msg.id
                            }));
                        } else {
                            ws.send(JSON.stringify({
                                cmd: 'retrievedSynthFile',
                                data: result
                            }));
                        }
                    } catch (err) {
                        console.error('❌ DB error (getSynthTemplateById):', err);
                        ws.send(JSON.stringify({
                            cmd: 'synthTemplateLoaded',
                            error: err.message
                        }));
                    }
                })();
            break

            case 'getSynthTemplates':
                if(msg.filter){
                    getSynthTemplates(ws, msg.filter, msg.query);
                } else {
                    getSynthTemplates(ws);
                }
                    

            break

            case 'getPatchHistories':
                if(msg.filter){
                    getPatchHistories(ws, msg.filter, msg.query);
                } else {
                    getPatchHistories(ws);
                }
                    

            break



            case 'updateGraph':
                patchHistory = msg.patchHistory
                updateHistoryGraph(ws, patchHistory, msg.docHistoryGraphStyling)
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
                console.log('number of peers in room',  )
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

function updateHistoryGraph(ws, patchHistory, docHistoryGraphStyling){

    if (!existingHistoryNodeIDs || existingHistoryNodeIDs.size === 0){
        existingHistoryNodeIDs = new Set(historyDAG_cy.nodes().map(node => node.id()));
    }

    if(!patchHistory || !patchHistory.branchOrder) return
    const { nodes, edges, historyNodes } = buildHistoryGraph(
        patchHistory,
        existingHistoryNodeIDs,
        docHistoryGraphStyling
    );
    // dumb hack for weird bug where the parent prop in each node was coming out undefined despite existing in the return statement of buildHistoryGraph
    const stringed = JSON.parse(JSON.stringify(nodes, null, 2))
    // Run the layout and get the rendered graph
    // historyDAG_cy.layout(layout).run();
    try {
        if (nodes.length > 0) {
            historyDAG_cy.add(stringed);
        }
        if (edges.length > 0) {
            historyDAG_cy.add(edges); // 👈 this is where it was crashing
        }
    } catch (err) {
        console.error('❌ Failed to update Cytoscape graph:', err.message);
        console.error('   ➤ Possibly due to missing source or target node.');
        console.error('   ➤ Reason:', err.stack);
        console.error('   ➤ Edges:', JSON.stringify(edges, null, 2));
        // send message to client to force a new patch history
        setTimeout(() => {
            ws.send(JSON.stringify({
                cmd: "forceNewPatchHistoryDueToError", 
                message: 'Server failed to create graph; forcing a new patch history now...'
            }))
        }, 1000);


        return; // prevent graph layout from running
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

async function getSynthTemplates(ws, filter, query) {
    if(filter){
        console.log('query detected')
        switch (filter){
            case 'tags':
                const tag = query;
                const result = await pool.query(
                    `SELECT id, name, author, description, tags FROM synth_templates WHERE $1 = ANY(tags) ORDER BY created_at DESC`,
                    [tag]
                );

                // Filter tags to include only the selected one
                const filteredRows = result.rows.map(entry => ({
                    ...entry,
                    tags: entry.tags.filter(t => t === tag)
                }));
                
                ws.send(JSON.stringify({ cmd: 'synthTemplatesList', data: filteredRows }));
            break

            case 'authors':
                const author = query;
                try {
                    const result = await pool.query(
                    `SELECT id, name, author, description, tags
                    FROM synth_templates
                    WHERE author = $1
                    ORDER BY created_at DESC`,
                    [author]
                    );

                    ws.send(JSON.stringify({
                        cmd: 'synthTemplatesList',
                        data: result.rows
                    }));
                } catch (err) {
                    console.error('DB error (filterByAuthor):', err);
                    ws.send(JSON.stringify({
                        cmd: 'synthTemplatesList',
                        data: [],
                        error: err.message
                    }));
                }
            break
        }
    } else {
        try {
            const result = await pool.query(
                `SELECT id, name, author, description, tags FROM synth_templates ORDER BY created_at DESC`
            );
        
            ws.send(JSON.stringify({
                cmd: 'synthTemplatesList',
                data: result.rows
            }));
        } catch (err) {
            console.error('❌ DB error (getSynthTemplates):', err);
            ws.send(JSON.stringify({
                cmd: 'synthTemplatesList',
                data: [],
                error: err.message
            }));
        }
    }
    
  }
  

async function getPatchHistories(ws, filter, query) {
  
    try {
        let result;

        switch (filter) {
            case 'authors':
                result = await pool.query(
                    `SELECT * FROM patch_histories WHERE authors @> ARRAY[$1] ORDER BY created_at DESC`,
                    [query[0]]
                );
                break;

            case 'modules':
                result = await pool.query(
                    `SELECT * FROM patch_histories WHERE $1 = ANY(modules) ORDER BY created_at DESC`,
                    [query]
                );
                break;

            case 'forksOf':
                result = await pool.query(
                    `SELECT * FROM patch_histories WHERE forked_from_id = $1 ORDER BY created_at ASC`,
                    [query]
                );
                break;

            case 'id':
                result = await pool.query(
                    `SELECT * FROM patch_histories WHERE id = $1`,
                    [query]
                );
                break;

            default:
                result = await pool.query(
                    `SELECT * FROM patch_histories ORDER BY created_at DESC LIMIT 50`
                );
        }
        
        ws.send(JSON.stringify({
            cmd: 'patchHistoriesList',
            data: result.rows
        }));

    } catch (err) {
        console.error('❌ DB error (getPatchHistories):', err);
        ws.send(JSON.stringify({
            cmd: 'patchHistoriesList',
            data: [],
            error: err.message
        }));
    }
}

async function getUpdatedHistories(ws){

    try {
        let updatedList = await pool.query(
            `SELECT
                id,
                name,
                authors,
                description,
                tags,
                modules,
                forked_from_id,
                created_at
                FROM patch_histories
                ORDER BY created_at DESC
                LIMIT 50;
`
        );
        wss.clients.forEach((client) => {
            client.send(JSON.stringify({
                cmd: 'patchHistoriesList',
                data: updatedList.rows
            }));
        });

    } catch (err) {
        console.error('❌ DB error (getUpdatedHistoryList):', err);
    }

}