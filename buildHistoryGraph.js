/**
 * Generates nodes and edges for a history graph.
 *
 * @param {Object} meta - Metadata containing branch order and history details.
 * @param {Set} existingHistoryNodeIDs - Set of existing node IDs to avoid duplicates.
 * @param {Object} docHistoryGraphStyling - Styling information for nodes.
 * @returns {Object} - An object containing nodes, edges, and updated existingHistoryNodeIDs.
 */
function buildHistoryGraph(meta, existingHistoryNodeIDs, docHistoryGraphStyling) {
    const nodes = [];
    const edges = [];
    const nodeIdToYPos = new Map();

    // Accessing branches in order, create nodes and edges for each branch
    meta.branchOrder.forEach((branchName, branchIndex) => {
        const branch = meta.branches[branchName];
        console.log(branchName)
        // Iterate over each history item in the branch
        branch.history.forEach((item, nodeIndex) => {
            const nodeId = item.hash;
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
  


            // Check if the node already exists in the history graph
            if (!existingHistoryNodeIDs.has(nodeId)) {

                // store y pos of each node so that when creating a new branch we can set the 0th node of that branch to the same y as its parent in its origin branch
                let yPos;

                if (nodeIndex === 0 && branchIndex > 0 && parent) {
                    // get parent ID from string
                    const parentId = Array.isArray(parent) ? parent[0] : parent;
                    const parentY = nodeIdToYPos.get(parentId);
                
                    if (parentY !== undefined) {
                        yPos = parentY; // align with parent in earlier branch
                    } else {
                        yPos = 0; // fallback
                    }
                } else {
                    yPos = -nodeIndex * 50;
                }
            
                nodeIdToYPos.set(nodeId, yPos); // Track y-position

                console.log('parent', parent)
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
                        x: branchIndex * 150, // horizontal slot per branch
                        y: yPos   // stack nodes top to bottom
                    }
                    
                    
                }

                
                // Add node to the history graph
                nodes.push(newNode);

                // Add the newly added node's ID to the set to track it
                existingHistoryNodeIDs.add(nodeId);
            }
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
  