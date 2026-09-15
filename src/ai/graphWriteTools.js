/**
 * What the agent can change — or rather, propose changing.
 *
 * None of these touch the graph. They validate against it and append to a
 * staged set that the user sees and confirms. That is the whole safety model:
 * reading is free, writing is a proposal.
 *
 * Refusals come back as sentences the model can act on, not exceptions. A
 * refused delete should make it suggest something else, not end the turn.
 */

import { KIND_TO_TYPES, KIND_LIST } from './graphReadTools.js';

export { KIND_TO_TYPES, KIND_LIST };

export function createWriteTools(nodes, aliases) {
  const staged = [];
  const minted = new Map(); // alias the model invented → its staged add

  /** A reference is either an existing node, or one staged in this same turn. */
  const resolve = (ref) => {
    const node = aliases.nodeAt(ref);
    if (node) return { id: node.id, node };
    if (minted.has(ref)) return { id: ref, node: null };
    return null;
  };

  const number = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

  return {
    staged,
    tools: {
      add({ alias, parent, title, description, kind, x, y }) {
        if (!alias) return 'Give the new node an alias so other operations can point at it.';
        if (minted.has(alias) || aliases.nodeAt(alias)) {
          return `The alias ${alias} is already taken in this turn. Pick another.`;
        }
        if (!title || !title.trim()) return 'A node needs a title.';

        const types = KIND_TO_TYPES[kind];
        if (!types) {
          return `${kind} is not a kind I know. Use one of: ${KIND_LIST.join(', ')}.`;
        }

        let parentId = null;
        if (parent) {
          const found = resolve(parent);
          if (!found) return `There is no node called ${parent} to put this inside.`;
          parentId = found.id;
        }

        const operation = {
          op: 'add',
          alias,
          parent: parentId,
          title: title.trim(),
          description: typeof description === 'string' ? description : '',
          ...types,
          x: number(x),
          y: number(y),
          downstream: [],
        };

        staged.push(operation);
        minted.set(alias, operation);

        const where = parentId ? ` inside ${parent}` : ' at the top level';
        return `Staged: add "${operation.title}" (${kind})${where}, as ${alias}.`;
      },

      update({ target, title, description, kind, requiredCompletions }) {
        const found = resolve(target);
        if (!found) return `There is no node called ${target}.`;

        const operation = { op: 'update', target: found.id };

        if (typeof title === 'string' && title.trim()) operation.title = title.trim();
        if (typeof description === 'string' && description.trim()) operation.description = description;

        if (kind) {
          const types = KIND_TO_TYPES[kind];
          if (!types) return `${kind} is not a kind I know. Use one of: ${KIND_LIST.join(', ')}.`;
          Object.assign(operation, types);
        }

        if (Number.isFinite(requiredCompletions) && requiredCompletions > 0) {
          operation.requiredCompletions = requiredCompletions;
        }

        if (Object.keys(operation).length <= 2) {
          return 'That update changes nothing. Say which field should change.';
        }

        staged.push(operation);
        const name = found.node ? `"${found.node.title}"` : target;
        return `Staged: update ${name}.`;
      },

      remove({ target }) {
        const found = resolve(target);
        if (!found) return `There is no node called ${target}.`;

        // Deleting a parent takes its subtree with it, and nothing the agent
        // has read tells it what that costs.
        if (found.node?.children?.length > 0) {
          return `I will not delete "${found.node.title}" — it has ${found.node.children.length} node(s) inside, and they would go with it. Remove or move those first, or change it instead.`;
        }

        staged.push({ op: 'delete', target: found.id });
        const name = found.node ? `"${found.node.title}"` : target;
        return `Staged: delete ${name}.`;
      },

      link({ source, target }) {
        const from = resolve(source);
        const to = resolve(target);
        if (!from) return `There is no node called ${source}.`;
        if (!to) return `There is no node called ${target}.`;
        if (from.id === to.id) return 'A node cannot lead to itself.';

        staged.push({ op: 'link', source: from.id, target: to.id });
        return `Staged: ${source} → ${target}.`;
      },

      unlink({ source, target }) {
        const from = resolve(source);
        const to = resolve(target);
        if (!from) return `There is no node called ${source}.`;
        if (!to) return `There is no node called ${target}.`;

        staged.push({ op: 'unlink', source: from.id, target: to.id });
        return `Staged: disconnect ${source} from ${target}.`;
      },
    },
  };
}

export default createWriteTools;
