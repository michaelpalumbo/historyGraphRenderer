/**
 * Generates nodes and edges for a history graph.
 *
 * @param {Object} meta - Metadata containing branch order and history details.
 * @param {Set} existingHistoryNodeIDs - Set of existing node IDs to avoid duplicates.
 * @param {Object} docHistoryGraphStyling - Styling information for nodes.
 * @returns {Object} - An object containing nodes, edges, and updated existingHistoryNodeIDs.
 */
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const historyGraphYIncrement = 75

function buildHistoryGraph(meta, existingHistoryNodeIDs, docHistoryGraphStyling) {

    const outputPath = join(__dirname, 'meta.json');
    // writeFileSync(outputPath, JSON.stringify(meta, null, 2));
    const nodes = [];
    const edges = [];

    const nodeIdToYPos = new Map();
    const branchRootY = new Map();

    // Pass 1: calculate branch root Y positions
    meta.branchOrder.forEach((branchName, branchIndex) => {
    const branch = meta.branches[branchName];
    const firstItem = branch.history[0];
    let y;

    if (firstItem && firstItem.parent) {
        const parentId = Array.isArray(firstItem.parent) ? firstItem.parent[0] : firstItem.parent;
        const parentY = nodeIdToYPos.get(parentId);
        y = parentY !== undefined ? parentY : 0;
    } else {
        y = 0; // root branch
    }

        branchRootY.set(branchName, y);
    });

    const plannedYPositions = new Map();

    meta.branchOrder.forEach(branchName => {
        const branch = meta.branches[branchName];
        const firstItem = branch.history[0];

        let rootY = 0;

        if (firstItem && firstItem.parent) {
            const parentId = Array.isArray(firstItem.parent)
            ? firstItem.parent[0]
            : firstItem.parent;

            const parentY = plannedYPositions.get(parentId);
            rootY = parentY !== undefined ? parentY : 0;
        }

        branch.history.forEach((item, i) => {
                const y = rootY - (i + 1) * historyGraphYIncrement;
                plannedYPositions.set(item.hash, y);
            });
    });


 


    // Accessing branches in order, create nodes and edges for each branch
    meta.branchOrder.forEach((branchName, branchIndex) => {
        const branch = meta.branches[branchName];
        const rootY = branchRootY.get(branchName);

        // Iterate over each history item in the branch
        branch.history.forEach((item, nodeIndex) => {
            const nodeId = item.hash;

            if (existingHistoryNodeIDs.has(nodeId)) return;

            const yPos = plannedYPositions.get(item.hash);
            
            nodeIdToYPos.set(nodeId, yPos);

            let label;
            let parent = []
            // we now store the parent module data in the change message, so extract that so it doesn't appear as the label, and place it in the 'parent' prop
            // check if its a $PARENT or $PARENTS condition
            if(item.msg.includes('$PARENT ')){
                
                parent = item.msg.split('$PARENT ')[1]
                label = `${item.msg.split('$PARENT ')[0]} ${parent.split('_')[0]}_${parent.split('_')[1]}`
            } else if (item.msg.includes("$PARENTS ")){
                label = item.msg.split('$PARENTS ')[0]
                parent = item.msg.split('$PARENTS ')[1]
            } else if (item.msg.includes('.fpsynth')){
                label = `loaded ${item.msg}`
                // parent = []
            } 

            const newNode = {
                group: "nodes",
                data: {
                    id: nodeId,
                    label: label,
                    color: docHistoryGraphStyling.nodeColours[item.msg.split(" ")[0]] || "#ccc",
                    branch: branchName,
                    parents: parent || null,
                    timeStamp: item.timeStamp

                },
                // Add a manual position!
                position: {
                    x: branchIndex * 220, // horizontal slot per branch
                    y: yPos   // stack nodes top to bottom
                }
                
                
            }

            
            // Add node to the history graph
            nodes.push(newNode);

            // Add the newly added node's ID to the set to track it
            existingHistoryNodeIDs.add(nodeId);
            
        });
    });

    // now that all nodes are made, create their edges

    meta.branchOrder.forEach((branchName) => {
        const branch = meta.branches[branchName];

        // Iterate over each history item in the branch
        branch.history.forEach((item) => {
            const nodeId = item.hash;

            // ! this is where we'll also figure out how to deal with 2 parents in the case of a merge!
            // If the history item has a parent, add an edge to connect the parent
            if (item.parent) {
                // first check if item.parent is an array. if it is, then this node is a merge between 2 parents
                if(Array.isArray(item.parent)){
                    console.log('this is a merge')

                    item.parent.forEach((parent, index)=>{
                        edges.push({
                            group: "edges",
                            data: {
                                id: `${item.parent[index]}_to_${nodeId}`,
                                source: item.parent[index],
                                target: nodeId,
                            },
                        });
                    })
                } else {
                                // //Make sure the parent node also exists before adding the edge
                // if (existingHistoryNodeIDs.has(item.parent)) {
                    edges.push({
                        group: "edges",
                        data: {
                            id: `${item.parent}_to_${nodeId}`,
                            source: item.parent,
                            target: nodeId,
                        },
                    });
                }
            }
            
        });

        
    });

    return { nodes, edges, existingHistoryNodeIDs };
}

export default buildHistoryGraph;
  