import {
	appendInitialChild,
	Container,
	createInstance,
	createTextInstance,
	Instance
} from 'hostConfig';
import { FiberNode } from './fiber';
import { NoFlags, Ref, Update } from './fiberFlags';
import {
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';

/**
 * 标记 Ref
 * @param fiber {FiberNode} 需要被标记的 fiber 节点
 */
function markRef(fiber: FiberNode) {
	fiber.flags |= Ref;
}

/**
 * 标记 Update 的 flags
 * @param fiber {FiberNode} 需要被标记的 fiber 节点
 */
function markUpdate(fiber: FiberNode) {
	fiber.flags |= Update;
}

/**
 * mount 阶段：将 wip.child 对应的 DOM 挂载到刚创建出来的 DOM 上，形成一棵离屏的 DOM 树
 * update 阶段：比较 props 是否更改，若更改，则打上 Update 的 flags，否则不做任何操作。还有就是标记 Ref
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 */
export const completeWork = (wip: FiberNode) => {
	// 递归中的归

	const newProps = wip.pendingProps;
	const current = wip.alternate;

	switch (wip.tag) {
		case HostComponent:
			if (current !== null && wip.stateNode) {
				// TODO update
				// 1. props 是否变化
				// 2. 变化了，需要打上一个 Update 的 Flags
				// 判断 className, style 是否变化
				markUpdate(wip);
				// 标记 Ref
				if (current.ref !== wip.ref) {
					markRef(wip);
				}
			} else {
				// mount
				// 1. 构建 DOM
				// 2. 将 DOM 插入到 DOM 树
				// const instance = createInstance(wip.type, newProps);
				const instance = createInstance(wip.type, newProps);
				appendAllChildren(instance, wip);
				wip.stateNode = instance;
				// 标记 Ref
				if (wip.ref !== null) {
					markRef(wip);
				}
			}
			bubbleProperties(wip);
			return null;

		case HostText:
			if (current !== null && wip.stateNode) {
				// update
				// 获取旧的 text
				const oldText = current.memoizedProps?.content;
				// 获取新的 text
				const newText = newProps.content;
				// 比对 oldText 和 newText 是否相同，不同则标记 Update 的 flags
				if (oldText !== newText) {
					markUpdate(wip);
				}
			} else {
				// mount
				// 1. 构建 DOM
				// 2. 将 DOM 插入到 DOM 树
				const instance = createTextInstance(newProps.content);
				wip.stateNode = instance;
			}
			bubbleProperties(wip);
			return null;

		case HostRoot:
		case FunctionComponent:
		case Fragment:
			bubbleProperties(wip);
			return null;

		default:
			if (__DEV__) {
				console.warn('未处理的completeWork情况: ', wip);
			}
			break;
	}
};

/**
 * 将 wip.child 对应的 DOM 挂载到刚创建出来的 DOM (指代 parent) 上，形成一棵离屏的 DOM 树
 * @param parent {Container | Instance} 表示刚创建出来的 DOM，这里可以理解为是时 wip 对应的 DOM
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 */
function appendAllChildren(parent: Container | Instance, wip: FiberNode) {
	// 获取当前 wip 的子节点 fiberNode
	let node = wip.child;

	// 遍历获取下一个 DOM 节点
	while (node !== null) {
		// 如果 node 类型为 HostComponent 或者 HostText，则直接挂载到 parent 对应的 DOM 节点下
		if (node.tag === HostComponent || node.tag === HostText) {
			appendInitialChild(parent, node?.stateNode);
		} else if (node.child !== null) {
			// 如果是非 DOM 节点，则继续往下遍历，直到找到 DOM 节点为止
			node.child.return = node;
			node = node.child;
			continue;
		}

		// 如果遍历到 wip 本身，则结束遍历
		if (node === wip) {
			return;
		}

		while (node.sidling === null) {
			// 同样的，如果遍历到了 wip 本身，则结束遍历
			if (node.return === null || node.return === wip) {
				return;
			}
			// 如果没有 sidling 节点了，则执行归操作回溯
			node = node?.return;
		}
		// 查看是否有 sidling 节点，有则接着把 sidling 对应的节点都挂载上
		node.sidling.return = node.return;
		node = node.sidling;
	}
}

/**
 * 将子孙节点的操作 flags 一级级往上冒泡到 wip 的 subtreeFlags 属性中
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 */
function bubbleProperties(wip: FiberNode) {
	let subtreeFlags = NoFlags;
	let child = wip.child;

	while (child !== null) {
		subtreeFlags |= child.subtreeFlags;
		subtreeFlags |= child.flags;

		child.return = wip;
		child = child.sidling;
	}

	wip.subtreeFlags |= subtreeFlags;
}
