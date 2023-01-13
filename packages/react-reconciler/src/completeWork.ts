import {
	appendInitialChild,
	Container,
	createInstance,
	createTextInstance
} from 'hostConfig';
import { FiberNode } from './fiber';
import { NoFlags } from './fiberFlags';
import { HostComponent, HostRoot, HostText } from './workTags';

export const completeWork = (wip: FiberNode) => {
	// 递归中的归

	const newProps = wip.pendingProps;
	const current = wip.alternate;

	switch (wip.tag) {
		case HostComponent:
			if (current !== null && wip.stateNode) {
				// update
			} else {
				// mount
				// 1. 构建 DOM
				// 2. 将 DOM 插入到 DOM 树
				// const instance = createInstance(wip.type, newProps);
				const instance = createInstance(wip.type);
				appendAllChildren(instance, wip);
				wip.stateNode = instance;
			}
			bubbleProperties(wip);
			return null;

		case HostText:
			if (current !== null && wip.stateNode) {
				// update
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
			bubbleProperties(wip);
			return null;

		default:
			if (__DEV__) {
				console.warn('未处理的completeWork情况: ', wip);
			}
			break;
	}
};

// 将 wip.child 对应的 DOM 挂载到刚创建出来的 DOM 上，形成一棵离屏的 DOM 树
function appendAllChildren(parent: Container, wip: FiberNode) {
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

// 将子孙节点的操作 flags 一级级往上冒泡到 wip 的 subtreeFlags 属性中
function bubbleProperties(wip: FiberNode) {
	let subtreeFlags = NoFlags;
	let child = wip.child;

	while (child !== null) {
		subtreeFlags |= child.subtreeFlags;
		subtreeFlags |= wip.flags;

		child.return = wip;
		child = child.sidling;
	}

	wip.subtreeFlags |= subtreeFlags;
}
