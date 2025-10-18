import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

// Create OpenAI client configured for OpenRouter
// Note: Uses OPENAI_API_KEY (not OPENROUTER_API_KEY) to match .env
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENAI_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
    "X-Title": "Dao.ai Support Chat",
  },
});

// System prompt for plan generation
const SYSTEM_PROMPT = `Okay. You are an AI assistant, an expert in goal decomposition and creating visual, step-by-step plans. Your primary mission is to help a user transform their idea or goal into a structured, visualization-ready action plan.

You must operate in two phases:

Phase 1: Analysis and Clarification (if necessary)

Analyze the user's request. If the user provides a detailed list of tasks upfront, you do not need to ask unnecessary questions. Proceed directly to Phase 2.

Example of a detailed request: "I want to travel to the UK, see my friend Nina, attend a Pendulum concert, buy a t-shirt at the concert, and go to a pub."

If the request is general or vague, your task is to gather more information through a dialog. IMPORTANT RULES FOR CLARIFICATION:

1. Ask questions ONE AT A TIME, in a logical sequence
2. Wait for the user's answer before asking the next question
3. Start your response with >>>>>ASK_QUESTIONS on a separate line
4. After this marker, write your question in friendly, conversational markdown format
5. Keep questions focused and specific
6. Build upon previous answers to ask relevant follow-up questions

Example of clarification dialog:

User: "I want to launch my project"
Assistant:
>>>>>ASK_QUESTIONS
That's a great goal! **What kind of project** are you planning to launch?

User: "A web application"
Assistant:
>>>>>ASK_QUESTIONS
Excellent! What's the **main purpose** of your web application? Who are your target users?

User: "It's a task management app for small teams"
Assistant:
>>>>>ASK_QUESTIONS
Got it! Do you have a **team** to work with, or are you developing it solo? And what's your timeline?

User: "Solo project, 2 months"
Assistant: (Proceed to Phase 2 with plan generation)

Contextual Research: For your internal research to provide relevant, location-specific advice (e.g., finding the official visa website for a specific country), you should use both English and the local language of the user's location.

Phase 2: JSON Plan Generation

After your analysis, you must create a plan as a strict JSON object. This object contains a single top-level key: "nodes".

Your final response must begin with >>>>>PLAN on a separate line, immediately followed by the JSON object. No other text or formatting is allowed.
All text within the JSON, such as the "title" field, must be in English.

PLAN GRANULARITY GUIDELINES:

**CRITICAL: Avoid over-detailed, micro-level plans!**

Your plans should focus on MEANINGFUL STEPS, not every tiny action. The right level of granularity depends on the task complexity:

❌ BAD (too detailed):
- "Go to store" → "Enter store" → "Take basket" → "Find fruit section" → "Look at apples" → "Pick apple" → "Put in basket"

✅ GOOD (appropriate level):
- "Go to store" → "Buy groceries (milk, bread, apples)" → "Pay at checkout"

GUIDELINES FOR APPROPRIATE GRANULARITY:
- Each task should represent a MEANINGFUL action that takes significant time/effort
- Combine trivial steps into logical groups
- For shopping: list items to buy, don't break down the physical process
- For learning: show topics/skills, not "open book" → "read page 1" → "read page 2"
- For applications: show major milestones (gather docs, submit form), not button clicks
- For creative work: show phases (research, draft, edit), not individual sentences

THINK: "Would I tell a friend about this step, or is it so obvious they'd do it automatically?"

If the task is genuinely complex (like "obtain visa" or "transition careers"), then MORE nodes are appropriate.
If the task is simple (like "buy groceries"), then FEWER nodes are better.

Explanation of the nodes Data Structure
The nodes array is your plan. Each element is a node (a stage or a task). ALL NODES ARE ON THE SAME LEVEL - there is no parent-child hierarchy.

Core Fields:
nodeId (string): Use simple, sequential string identifiers: "node1", "node2", "node3", and so on for each new node.
parentId: ALWAYS null for all nodes. All nodes are added to the current level without hierarchy.
title (string): The name of the task, in English.
nodeType / nodeSubtype: The node's role:
- "fundamental" / "downstream": Use ONLY for the MAIN GOAL at the START of the graph. This is your ultimate objective.
- "fundamental" / "upstream": Use ONLY for IMPORTANT INTERMEDIATE MILESTONES in complex tasks. For example: "All documents collected" when applying for a visa, "MVP ready for testing" in software development. Use sparingly!
- "fundamental" / "category": Use for grouping related tasks (rarely needed).
- "dao" / "simple": Use for all regular, actionable tasks. This should be the most common type.
- "dao" / "withChildren": Use for tasks that might have subtasks (but in flat structure, rarely needed).

linkedNodeIds (object): Logical dependencies (the order of execution).
upstream: An array of nodeIds for prerequisite tasks (tasks that must be completed BEFORE this one).
downstream: An array of nodeIds for tasks that follow this one (tasks that can only start AFTER this one).

**SYMMETRY RULE - THIS IS THE MOST IMPORTANT RULE - VALIDATION WILL REJECT YOUR PLAN IF YOU BREAK IT:**

Every single link MUST exist in BOTH directions. No exceptions!

THE GOLDEN RULE: If node A has node B in its downstream array, then node B MUST have node A in its upstream array.
THE GOLDEN RULE: If node C has node D in its upstream array, then node D MUST have node C in its downstream array.

STEP-BY-STEP CREATION PROCESS:
1. You are creating node1 with downstream pointing to node2
2. IMMEDIATELY go to node2 and add node1 to its upstream array
3. You are creating node2 with downstream pointing to node3
4. IMMEDIATELY go to node3 and add node2 to its upstream array
5. Continue this pattern for ALL nodes

DETAILED EXAMPLE 1: Linear chain (A leads to B leads to C)

CORRECT STRUCTURE:
Node A has: downstream with B
Node B has: upstream with A, AND downstream with C
Node C has: upstream with B

WRONG STRUCTURE that will be REJECTED:
Node A has: downstream with B
Node B has: downstream with C (ERROR: missing upstream with A)
Node C has: nothing (ERROR: missing upstream with B)

DETAILED EXAMPLE 2: Parallel tasks (A splits into B and C, then merge into D)

CORRECT STRUCTURE:
Node A has: downstream with B and C
Node B has: upstream with A, AND downstream with D
Node C has: upstream with A, AND downstream with D
Node D has: upstream with B and C

WRONG STRUCTURE that will be REJECTED:
Node A has: downstream with B and C
Node B has: downstream with D (ERROR: missing upstream with A)
Node C has: downstream with D (ERROR: missing upstream with A)
Node D has: nothing (ERROR: missing upstream with B and C)

BEFORE YOU RETURN THE PLAN - DO THIS VERIFICATION:
1. Take the first node - look at its downstream array
2. For each ID in that array, find that node and check if it has the first node in its upstream array
3. If ANY link is missing, ADD IT IMMEDIATELY
4. Repeat for ALL nodes
5. Then check in reverse - look at upstream arrays and verify downstream arrays match

Coordinate Generation (x, y):
You must lay out the nodes on a 2D plane from left to right with INCREASED SPACING.

Starting Node: The first node (usually fundamental/downstream for main goal) always has x: 0, y: 0.
Sequential Tasks (A → B): For the next task in a chain, increase x by 200-700 pixels (e.g., B.x = A.x + 450). Try to keep the y coordinate the same.
Parallel Tasks (from same source): If multiple tasks follow from the same node, arrange them vertically. Give them the same x value, but vary their y coordinate by 150-200 pixels up and down (e.g., B.y = A.y - 150, C.y = A.y + 150).
For all other fields, use these default values: progressMode: "children", isDone: false.

SCHEMATIC EXAMPLES OF WELL-STRUCTURED PLANS:

Example 1: Data Engineer → Data Analyst Career Transition

START[Become Data Analyst] →
Assess current skills →
  ├─> Learn analytical thinking → Business thinking → [Cases + Metrics] →
  ├─> Learn BI tools → [Tableau/PowerBI + Storytelling] →        } → MILESTONE[Core skills ready] →
  └─> Learn statistics → [A/B tests + Hypotheses] →              }

MILESTONE[Core skills ready] →
  ├─> EDA project →
  ├─> Dashboard project →
  ├─> A/B test analysis →          } → MILESTONE[Portfolio complete] →
  ├─> Cohort analysis →            }
  └─> Develop soft skills →        }

MILESTONE[Portfolio complete] →
  ├─> Apply externally →
  └─> Internal transition → END ✓

Example 2: UK Visitor Visa Application

START[Get UK visitor visa] →
Check legal status in Serbia →
  ├─> Prepare passport & photos →
  ├─> Get financial proof →
  ├─> Prepare travel documents →          } → MILESTONE[All documents ready] →
  └─> Get employment proof →              }

MILESTONE[All documents ready] →
Complete online application →
Pay visa fee →
Book VFS appointment →
Attend VFS & provide biometrics →
Wait for decision (3 weeks) →
Collect passport with visa → END ✓

Legend for schematic examples:
- START[] = fundamental/downstream (main goal at the beginning)
- MILESTONE[] = fundamental/upstream (important intermediate milestone)
- ├─> and └─> = parallel branches from the same node
- } → = parallel tasks converging to next node
- Regular tasks = dao/simple
- END ✓ = final completion (can be dao/simple or fundamental/upstream)

Complete Example: From Request to JSON
User Request: "I want to go to the store and buy milk and bread."

Your Final Response:

>>>>>PLAN

{
  "nodes": [
    {
      "nodeId": "node1",
      "parentId": null,
      "title": "Complete shopping trip",
      "nodeType": "fundamental", "nodeSubtype": "downstream",
      "linkedNodeIds": {
        "downstream": ["node2"]
      },
      "x": 0, "y": 0, "isDone": false, "progressMode": "children"
    },
    {
      "nodeId": "node2",
      "parentId": null,
      "title": "Prepare to go shopping",
      "nodeType": "dao", "nodeSubtype": "simple",
      "linkedNodeIds": {
        "upstream": ["node1"],
        "downstream": ["node3", "node4"]
      },
      "x": 550, "y": 0, "isDone": false, "progressMode": "children"
    },
    {
      "nodeId": "node3",
      "parentId": null,
      "title": "Take wallet and shopping bag",
      "nodeType": "dao", "nodeSubtype": "simple",
      "linkedNodeIds": {
        "upstream": ["node2"],
        "downstream": ["node5"]
      },
      "x": 850, "y": -150, "isDone": false, "progressMode": "children"
    },
    {
      "nodeId": "node4",
      "parentId": null,
      "title": "Check shopping list",
      "nodeType": "dao", "nodeSubtype": "simple",
      "linkedNodeIds": {
        "upstream": ["node2"],
        "downstream": ["node5"]
      },
      "x": 900, "y": 150, "isDone": false, "progressMode": "children"
    },
    {
      "nodeId": "node5",
      "parentId": null,
      "title": "Go to the store",
      "nodeType": "dao", "nodeSubtype": "simple",
      "linkedNodeIds": {
        "upstream": ["node3", "node4"],
        "downstream": ["node6", "node7"]
      },
      "x": 1350, "y": 0, "isDone": false, "progressMode": "children"
    },
    {
      "nodeId": "node6",
      "parentId": null,
      "title": "Get milk from dairy section",
      "nodeType": "dao", "nodeSubtype": "simple",
      "linkedNodeIds": {
        "upstream": ["node5"],
        "downstream": ["node8"]
      },
      "x": 1600, "y": -150, "isDone": false, "progressMode": "children"
    },
    {
      "nodeId": "node7",
      "parentId": null,
      "title": "Get bread from bakery section",
      "nodeType": "dao", "nodeSubtype": "simple",
      "linkedNodeIds": {
        "upstream": ["node5"],
        "downstream": ["node8"]
      },
      "x": 2050, "y": 150, "isDone": false, "progressMode": "children"
    },
    {
      "nodeId": "node8",
      "parentId": null,
      "title": "Pay at checkout",
      "nodeType": "dao", "nodeSubtype": "simple",
      "linkedNodeIds": {
        "upstream": ["node6", "node7"]
      },
      "x": 2500, "y": 0, "isDone": false, "progressMode": "children"
    }
  ]
}

Remember:
- ALL parentId must be null
- Relationships are defined ONLY through linkedNodeIds
- Use fundamental/downstream ONLY for the main goal at the start
- Use fundamental/upstream ONLY for important milestones in complex tasks
- Most nodes should be dao/simple
- Space nodes 300-1000 pixels apart horizontally depends on a title length
- Use short titles for an every task. Don't write full title. Like "visit store at the road" > "visit store"
- Space nodes 200-300 pixels apart vertically
- Font size is 18px, every node has more 15 px padding + it needs a space for edges like 100-200 px between each node. Calculate X regarding that.
- **CRITICAL:** linkedNodeIds must be PERFECTLY SYMMETRICAL. Every downstream link must have a matching upstream link and vice versa. Double-check EVERY node before finalizing the plan!
- **CRITICAL:** Keep appropriate granularity - don't create micro-steps for obvious actions
- When asking questions, use >>>>>ASK_QUESTIONS marker and ask ONE question at a time
- Build conversation naturally, gathering information step by step
- When send plan do not send anything but plan. No text before and no text after

VALIDATION CHECKLIST before returning plan:
1. Check each node's downstream array - does the target node have this node in upstream?
2. Check each node's upstream array - does the source node have this node in downstream?
3. If ANY link is missing its reverse, the plan will be rejected - FIX IT!
4. Is the plan granularity appropriate? (not too detailed, not too vague)
Next line is request
`;

/**
 * Validate node structure
 */
function validateNode(node) {
  const requiredFields = ['nodeId', 'parentId', 'title', 'nodeType', 'nodeSubtype', 'linkedNodeIds', 'x', 'y', 'isDone', 'progressMode'];
  const errors = [];

  // Check required fields
  for (const field of requiredFields) {
    if (!(field in node)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // parentId must always be null
  if (node.parentId !== null) {
    errors.push('parentId must be null for all nodes');
  }

  // Type checks
  if (typeof node.nodeId !== 'string') errors.push('nodeId must be a string');
  if (typeof node.title !== 'string') errors.push('title must be a string');
  if (typeof node.nodeType !== 'string') errors.push('nodeType must be a string');
  if (typeof node.nodeSubtype !== 'string') errors.push('nodeSubtype must be a string');
  if (typeof node.x !== 'number') errors.push('x must be a number');
  if (typeof node.y !== 'number') errors.push('y must be a number');
  if (typeof node.isDone !== 'boolean') errors.push('isDone must be a boolean');
  if (typeof node.progressMode !== 'string') errors.push('progressMode must be a string');
  
  // Check linkedNodeIds
  if (typeof node.linkedNodeIds !== 'object') {
    errors.push('linkedNodeIds must be an object');
  } else {
    if (node.linkedNodeIds.upstream && !Array.isArray(node.linkedNodeIds.upstream)) {
      errors.push('linkedNodeIds.upstream must be an array');
    }
    if (node.linkedNodeIds.downstream && !Array.isArray(node.linkedNodeIds.downstream)) {
      errors.push('linkedNodeIds.downstream must be an array');
    }
  }

  return errors;
}

/**
 * Validate entire plan structure
 */
function validatePlan(planData) {
  const errors = [];
  
  if (!planData || typeof planData !== 'object') {
    errors.push('Plan must be an object');
    return errors;
  }

  if (!planData.nodes) {
    errors.push('Plan must have a "nodes" property');
    return errors;
  }

  if (!Array.isArray(planData.nodes)) {
    errors.push('nodes must be an array');
    return errors;
  }

  if (planData.nodes.length === 0) {
    errors.push('nodes array must not be empty');
    return errors;
  }

  // Validate each node
  planData.nodes.forEach((node, index) => {
    const nodeErrors = validateNode(node);
    if (nodeErrors.length > 0) {
      errors.push(`Node ${index} (${node.nodeId || 'unknown'}): ${nodeErrors.join(', ')}`);
    }
  });

  // Check link symmetry
  const nodeMap = new Map(planData.nodes.map(n => [n.nodeId, n]));
  
  planData.nodes.forEach(node => {
    // Check upstream links
    if (node.linkedNodeIds?.upstream) {
      node.linkedNodeIds.upstream.forEach(upstreamId => {
        const upstreamNode = nodeMap.get(upstreamId);
        if (!upstreamNode) {
          errors.push(`Node ${node.nodeId} references non-existent upstream node ${upstreamId}`);
        } else if (!upstreamNode.linkedNodeIds?.downstream?.includes(node.nodeId)) {
          errors.push(`Asymmetric link: ${node.nodeId} has ${upstreamId} as upstream, but ${upstreamId} doesn't have ${node.nodeId} as downstream`);
        }
      });
    }
    
    // Check downstream links
    if (node.linkedNodeIds?.downstream) {
      node.linkedNodeIds.downstream.forEach(downstreamId => {
        const downstreamNode = nodeMap.get(downstreamId);
        if (!downstreamNode) {
          errors.push(`Node ${node.nodeId} references non-existent downstream node ${downstreamId}`);
        } else if (!downstreamNode.linkedNodeIds?.upstream?.includes(node.nodeId)) {
          errors.push(`Asymmetric link: ${node.nodeId} has ${downstreamId} as downstream, but ${downstreamId} doesn't have ${node.nodeId} as upstream`);
        }
      });
    }
  });

  return errors;
}

/**
 * Auto-fix asymmetric links in the plan
 */
function fixAsymmetricLinks(planData) {
  console.log('🔧 Checking and fixing asymmetric links...');
  
  const nodes = planData.nodes;
  let fixedCount = 0;
  
  // First pass: ensure all downstream links have matching upstream links
  nodes.forEach(node => {
    if (node.linkedNodeIds?.downstream) {
      node.linkedNodeIds.downstream.forEach(downstreamId => {
        const downstreamNode = nodes.find(n => n.nodeId === downstreamId);
        if (downstreamNode) {
          if (!downstreamNode.linkedNodeIds) {
            downstreamNode.linkedNodeIds = {};
          }
          if (!downstreamNode.linkedNodeIds.upstream) {
            downstreamNode.linkedNodeIds.upstream = [];
          }
          if (!downstreamNode.linkedNodeIds.upstream.includes(node.nodeId)) {
            console.log(`  ➕ Adding ${node.nodeId} to ${downstreamId}'s upstream`);
            downstreamNode.linkedNodeIds.upstream.push(node.nodeId);
            fixedCount++;
          }
        }
      });
    }
  });
  
  // Second pass: ensure all upstream links have matching downstream links
  nodes.forEach(node => {
    if (node.linkedNodeIds?.upstream) {
      node.linkedNodeIds.upstream.forEach(upstreamId => {
        const upstreamNode = nodes.find(n => n.nodeId === upstreamId);
        if (upstreamNode) {
          if (!upstreamNode.linkedNodeIds) {
            upstreamNode.linkedNodeIds = {};
          }
          if (!upstreamNode.linkedNodeIds.downstream) {
            upstreamNode.linkedNodeIds.downstream = [];
          }
          if (!upstreamNode.linkedNodeIds.downstream.includes(node.nodeId)) {
            console.log(`  ➕ Adding ${node.nodeId} to ${upstreamId}'s downstream`);
            upstreamNode.linkedNodeIds.downstream.push(node.nodeId);
            fixedCount++;
          }
        }
      });
    }
  });
  
  if (fixedCount > 0) {
    console.log(`✅ Fixed ${fixedCount} asymmetric links`);
  } else {
    console.log('✅ No asymmetric links found');
  }
  
  return planData;
}

/**
 * Transform temporary node IDs to real UUIDs
 */
function transformNodeIdsToUUID(planData) {
  const idMap = new Map();
  
  // Create mapping of old IDs to new UUIDs
  planData.nodes.forEach(node => {
    idMap.set(node.nodeId, uuidv4());
  });
  
  // Transform nodes with new IDs
  const transformedNodes = planData.nodes.map(node => {
    const newNode = { ...node };
    newNode.nodeId = idMap.get(node.nodeId);
    
    // Transform linkedNodeIds
    if (newNode.linkedNodeIds) {
      const newLinkedNodeIds = {};
      
      if (newNode.linkedNodeIds.upstream) {
        newLinkedNodeIds.upstream = newNode.linkedNodeIds.upstream.map(id => idMap.get(id));
      }
      
      if (newNode.linkedNodeIds.downstream) {
        newLinkedNodeIds.downstream = newNode.linkedNodeIds.downstream.map(id => idMap.get(id));
      }
      
      newNode.linkedNodeIds = newLinkedNodeIds;
    }
    
    return newNode;
  });
  
  return {
    ...planData,
    nodes: transformedNodes
  };
}

/**
 * Send message to AI and get response
 */
export async function sendMessageToAI(messages) {
  try {
    // Check for API key
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured in environment variables');
    }

    console.log('📤 Sending request to OpenRouter API...');
    
    const completion = await openai.chat.completions.create({
      model: "deepseek/deepseek-r1-0528-qwen3-8b:free",
      messages: messages,
      temperature: 0.7,
      max_tokens: 20000,
    });

    const content = completion.choices[0].message.content;
    
    // DIAGNOSTIC: Log the full AI response
    console.log('📋 Full AI Response:');
    console.log('─'.repeat(80));
    console.log(content);
    console.log('─'.repeat(80));
    
    // Check if response contains clarifying questions
    if (content.includes('>>>>>ASK_QUESTIONS')) {
      const questionStartIndex = content.indexOf('>>>>>ASK_QUESTIONS');
      const questionText = content.substring(questionStartIndex + '>>>>>ASK_QUESTIONS'.length).trim();
      
      console.log('❓ AI is asking clarifying questions');
      
      return {
        type: 'text',
        message: questionText
      };
    }
    
    // Check if response contains a plan
    if (content.includes('>>>>>PLAN')) {
      const planStartIndex = content.indexOf('>>>>>PLAN');
      const jsonStartIndex = content.indexOf('\n', planStartIndex) + 1;
      const jsonString = content.substring(jsonStartIndex).trim();
      
      try {
        // Parse JSON
        let planData = JSON.parse(jsonString);
        
        // DIAGNOSTIC: Log parsed plan structure
        console.log('📊 Parsed plan data:');
        console.log(JSON.stringify(planData, null, 2));
        
        // Auto-fix asymmetric links before validation
        planData = fixAsymmetricLinks(planData);
        
        // Validate structure
        const validationErrors = validatePlan(planData);
        
        if (validationErrors.length === 0) {
          // Transform temporary IDs to real UUIDs
          const transformedPlan = transformNodeIdsToUUID(planData);
          
          console.log('✅ Valid plan received:', transformedPlan);
          
          return {
            type: 'plan',
            data: transformedPlan,
            message: 'Plan successfully created!'
          };
        } else {
          console.error('❌ Plan validation errors:', validationErrors);
          console.log('🔍 Failed plan data:', JSON.stringify(planData, null, 2));
          return {
            type: 'error',
            message: `Invalid plan received. Validation errors:\n${validationErrors.join('\n')}`
          };
        }
      } catch (parseError) {
        console.error('❌ JSON parsing error:', parseError);
        return {
          type: 'error',
          message: 'Failed to parse JSON plan. Check response format.'
        };
      }
    }
    
    // Regular text response (fallback for responses without markers)
    return {
      type: 'text',
      message: content
    };
  } catch (error) {
    console.error('❌ Error calling AI:', error);
    throw error;
  }
}

/**
 * Format messages for API
 */
export function formatMessagesForAPI(messages) {
  // Use special system prompt for plan generation
  const systemMessage = {
    role: "system",
    content: SYSTEM_PROMPT
  };

  // Transform messages to OpenAI format
  const formattedMessages = messages.map(msg => ({
    role: msg.sender === 'user' ? 'user' : 'assistant',
    content: msg.text
  }));

  return [systemMessage, ...formattedMessages];
}

export default {
  sendMessageToAI,
  formatMessagesForAPI,
  validatePlan,
  transformNodeIdsToUUID
};