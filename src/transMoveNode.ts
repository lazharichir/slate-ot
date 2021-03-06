import {
  MoveNodeOperation,
  InsertNodeOperation,
  RemoveNodeOperation,
  Operation,
  Path,
  SplitNodeOperation,
} from 'slate';

import { xTransformMxN } from './SlateType';

export const transMoveNode = (
  leftOp: MoveNodeOperation,
  rightOp: Operation,
  side: 'left' | 'right'
): (MoveNodeOperation | RemoveNodeOperation | SplitNodeOperation)[] => {
  if (Path.equals(leftOp.path, leftOp.newPath)) {
    return [];
  }

  let [lr, li] = decomposeMove(leftOp);

  switch (rightOp.type) {
    case 'insert_node': {
      let [l] = xTransformMxN([lr, li], [rightOp], side);

      return [
        composeMove(<RemoveNodeOperation>l[0], <InsertNodeOperation>l[1]),
      ];
    }

    case 'remove_node': {
      let [l] = xTransformMxN([lr, li], [rightOp], side);

      // normal case
      if (l.length === 2) {
        return [
          {
            ...leftOp,
            ...composeMove(
              <RemoveNodeOperation>l[0],
              <InsertNodeOperation>l[1]
            ),
          },
        ];
      }

      // leftOp moves a branch into the removed zone
      else if (l.length === 1 && l[0].type === 'remove_node') {
        return [l[0]];
      }

      // leftOp moves a branch out of the removed zone
      // we choose NOT to keep it
      else if (l.length === 1 && l[0].type === 'insert_node') {
        return [];
      }

      // l.length === 0, move within the removed zone
      else {
        return [];
      }
    }

    case 'split_node': {
      const after: boolean =
        Path.isSibling(leftOp.path, leftOp.newPath) &&
        Path.endsBefore(leftOp.path, leftOp.newPath);

      // the split nodes have to move separately
      if (Path.equals(leftOp.path, rightOp.path)) {
        const newPath = Path.transform(leftOp.newPath, rightOp)!;
        // the split nodes are moved AFTER newPath
        if (after) {
          return [
            {
              ...leftOp, // move first node
              newPath,
            },
            {
              ...leftOp, // move second node
              newPath,
            },
          ];
        }

        // the split nodes are moved BEFORE newPath
        else {
          const firstMove: MoveNodeOperation = {
            ...leftOp, // move second node
            path: Path.next(leftOp.path),
            newPath,
          };

          const secondMove: MoveNodeOperation = {
            ...leftOp, // move first node
            path: Path.transform(leftOp.path, firstMove)!,
            newPath: Path.previous(Path.transform(newPath, firstMove)!),
          };

          return [firstMove, secondMove];
        }
      }

      let newPath = Path.transform(leftOp.newPath, rightOp)!;

      // the newPath is between the split nodes
      // note that it is impossible for newPath == rightOp.path
      if (Path.equals(newPath, Path.next(rightOp.path)) && !after) {
        newPath = rightOp.path;
      }

      // a tricky case:
      //   when after is true, and the splitOp separated path and newPath
      //   to no-longer be siblings, the after becomes false
      //   in this case we should move one step after
      else if (after && !Path.isSibling(leftOp.path, newPath)) {
        newPath = Path.next(newPath);
      }

      // finally, the normal case
      return [
        {
          ...leftOp,
          path: Path.transform(leftOp.path, rightOp)!,
          newPath,
        },
      ];
    }

    case 'merge_node': {
      let path = rightOp.path;
      let prevPath = Path.previous(path);

      path = Path.transform(path, leftOp)!;
      prevPath = Path.transform(prevPath, leftOp)!;

      // ops conflict with each other, discard merge
      // Note that the merge-and-split node cannot keep properties,
      //   so we have to remove it.
      if (!Path.equals(path, Path.next(prevPath))) {
        return [
          {
            ...rightOp,
            type: 'split_node',
            path: Path.previous(rightOp.path),
          },
          leftOp,
          {
            type: 'remove_node',
            path,
            node: { text: '' },
          },
        ];
      }

      // a tricky case:
      //   if leftOp.path is a child of rightOp.prevPath,
      //   and leftOp.newPath is a child of rightOp.path.
      //   intentionally, leftOp wants to insert BEFORE leftOp.newPath;
      //   but after merging, leftOp's path and newPath become siblings.
      //   the move dst turns out to be AFTER the transformed newPath.
      //   therefore we should move one step ahead
      if (
        Path.isParent(Path.previous(rightOp.path), leftOp.path) &&
        Path.isParent(rightOp.path, leftOp.newPath)
      ) {
        return [
          {
            ...leftOp,
            path: Path.transform(leftOp.path, rightOp)!,
            newPath: Path.previous(Path.transform(leftOp.newPath, rightOp)!),
          },
        ];
      }

      return [
        {
          ...leftOp,
          path: Path.transform(leftOp.path, rightOp)!,
          newPath: Path.transform(leftOp.newPath, rightOp)!,
        },
      ];
    }

    case 'move_node': {
      // the other side didn't do anything
      if (Path.equals(rightOp.path, rightOp.newPath)) {
        return [leftOp];
      }

      let [rr, ri] = decomposeMove(rightOp);

      let [l, r] = xTransformMxN([lr, li], [rr, ri], side);

      // normal case
      if (l.length === 2) {
        return [
          composeMove(<RemoveNodeOperation>l[0], <InsertNodeOperation>l[1]),
        ];
      }

      // handling conflict
      if (r.length === 1) {
        // must have l.length === 1 && l[0].type === r[0].type)
        return side === 'left' ? [reverseMove(rr, ri), leftOp] : [];
      }

      // for the rest we have r.length === 2
      if (l.length === 0) {
        l[0] = {
          type: 'remove_node',
          path: ri.path.concat(lr.path.slice(rr.path.length)),
          node: { text: '' },
        };
        l[1] = {
          type: 'insert_node',
          path: ri.path.concat(li.path.slice(rr.path.length)),
          node: { text: '' },
        };
      }

      // for the rest we have l.length === 1
      else if (l[0].type === 'remove_node') {
        l[1] = {
          type: 'insert_node',
          path: (<InsertNodeOperation>r[1]).path.concat(
            li.path.slice((<RemoveNodeOperation>r[0]).path.length)
          ),
          node: { text: '' },
        };
      }

      // for the rest we have l[0].type === 'insert_node'
      else {
        l[1] = l[0];
        l[0] = {
          type: 'remove_node',
          path: ri.path.concat(lr.path.slice(rr.path.length)),
          node: { text: '' },
        };
      }

      return [
        composeMove(<RemoveNodeOperation>l[0], <InsertNodeOperation>l[1]),
      ];
    }

    // insert_text
    // remove_text
    // set_node
    default:
      return [leftOp];
  }
};

export const decomposeMove = (
  op: MoveNodeOperation
): [RemoveNodeOperation, InsertNodeOperation] => {
  const rem: RemoveNodeOperation = {
    type: 'remove_node',
    path: op.path.slice(),
    node: { text: '' },
  };

  const ins: InsertNodeOperation = {
    type: 'insert_node',
    path: Path.transform(op.path, op)!,
    node: { text: '' },
  };

  return [rem, ins];
};

const composeMove = (
  rem: RemoveNodeOperation,
  ins: InsertNodeOperation
): MoveNodeOperation => {
  let path = rem.path;
  let newPath = Path.transform(ins.path, {
    ...rem,
    type: 'insert_node',
  })!;

  // this is a trick in slate:
  //   normally moving destination is right BEFORE newPath,
  //   however when the condition holds, it becomes right AFTER newPath
  if (Path.isSibling(path, newPath) && Path.endsBefore(path, newPath)) {
    newPath = Path.previous(newPath);
  }

  return {
    type: 'move_node',
    path,
    newPath,
  };
};

export const reverseMove = (
  rem: RemoveNodeOperation,
  ins: InsertNodeOperation
): MoveNodeOperation => {
  let path = ins.path;
  let newPath = Path.transform(rem.path, ins)!;

  if (Path.isSibling(path, newPath) && Path.endsBefore(path, newPath)) {
    newPath = Path.previous(newPath);
  }

  return {
    type: 'move_node',
    path,
    newPath,
  };
};
