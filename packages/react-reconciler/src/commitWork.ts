import {
	appendChildToContainer,
	commitUpdate,
	Container,
	insertChildToContainer,
	Instance,
	removeChild
} from 'hostConfig';
import { FiberNode, FiberRootNode, PendingPassiveEffects } from './fiber';
import {
	ChildDeletion,
	Flags,
	MutationMask,
	NoFlags,
	PassiveEffect,
	PassiveMask,
	Placement,
	Update
} from './fiberFlags';
import { Effect, FCUpdateQueue } from './fiberHooks';
import {
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';
import { HookHasEffect } from './hookEffectTags';

let nextEffect: FiberNode | null = null;

// 某个 fiberNode 节点的 subtreeFlags 或 flags 不为 NoFlags 就会进来该函数通过遍历，查找对应的节点，并执行对应的副作用
export const commitMutationEffects = (
	finishedWork: FiberNode,
	root: FiberRootNode
) => {
	nextEffect = finishedWork;

	// 总的遍历方式：一直往下遍历，直到 subtreeFlags 为 NoFlags；其次从其 sibling 出发；最后向上进行归操作
	while (nextEffect !== null) {
		// 向下遍历
		const child: FiberNode | null = nextEffect.child;

		if (
			(nextEffect.subtreeFlags & (MutationMask | PassiveMask)) !== NoFlags &&
			child !== null
		) {
			// 节点的 subtreeFlags 不为 NoFlags
			nextEffect = child;
		} else {
			// 节点的 subtreeFlags 为空 && (节点的 flags 不为 NoFlags 或为 NoFlags)
			up: while (nextEffect !== null) {
				commitMutationEffectsOnFiber(nextEffect, root);
				const sibling: FiberNode | null = nextEffect.sidling;

				if (sibling !== null) {
					nextEffect = sibling;
					break up;
				}

				nextEffect = nextEffect.return;
			}
		}
	}
};

// 匹配对应的副作用类型，并发起操作
const commitMutationEffectsOnFiber = (
	finishedWork: FiberNode,
	root: FiberRootNode
) => {
	const flags = finishedWork.flags;

	// 提交 Placement 操作
	if ((flags & Placement) !== NoFlags) {
		commitPlacement(finishedWork);
		finishedWork.flags &= ~Placement;
	}

	// 提交 Update 操作
	if ((flags & Update) !== NoFlags) {
		commitUpdate(finishedWork);
		finishedWork.flags &= ~Update;
	}

	// 提交 ChildDeletion 操作
	if ((flags & ChildDeletion) !== NoFlags) {
		// 获取节点中需要删除的子节点集合
		const deletions = finishedWork.deletions;
		if (deletions !== null) {
			// 遍历 deletions 并进入提交 Delete 操作函数
			deletions.forEach((childToDelete) => {
				commitDeletion(childToDelete, root);
			});
		}
		finishedWork.flags &= ~ChildDeletion;
	}
	if ((flags & PassiveEffect) !== NoFlags) {
		// 收集本轮更新需要执行的副作用回调
		commitPassiveEffect(finishedWork, root, 'update');
		finishedWork.flags &= ~PassiveEffect;
	}
};

// useEffect 收集回调
function commitPassiveEffect(
	fiber: FiberNode,
	root: FiberRootNode,
	type: keyof PendingPassiveEffects
) {
	// 这里存在两种情况，一种是 type 为 update，另一种是 type 为 unmount
	if (
		fiber.tag !== FunctionComponent ||
		(type === 'update' && (fiber.flags & PassiveEffect) === NoFlags)
	) {
		return;
	}

	// 获取 FunctionComponent.updateQueue，里边存储了该 FunctionComponent 所有的 Effect 实例对象链表
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
	if (updateQueue !== null) {
		if (updateQueue.lastEffect === null && __DEV__) {
			console.error(
				'当 Function Component 存在 PassiveEffect 的 flag 时，不应该不存在 Effect'
			);
		}
		// 将 Effect 链表存放在 FiberRootNode 中的 pendingPassiveEffects 属性中，交给调度器执行回调
		root.pendingPassiveEffects[type].push(updateQueue.lastEffect as Effect);
	}
}

// 传入 Effect 环形连中的最后一个，然后遍历 Effect 链表，判断每一个 Effect 实体是否符合执行副作用的条件，若符合，执行传入的 callback
function commitHookEffectList(
	flags: Flags,
	lastEffect: Effect,
	callback: (effect: Effect) => void
) {
	// 获取 Effect 链表中的第一个 Effect
	let effect = lastEffect.next as Effect;

	do {
		if ((effect.tag & flags) === flags) {
			callback(effect);
		}
		effect = effect.next as Effect;
	} while (effect !== lastEffect.next);
}

// 对 Effect 环形链中的 Effect 实例对象执行 Unmount 逻辑
export function commitHookEffectListUnmount(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const destroy = effect.destroy;
		if (typeof destroy === 'function') {
			destroy();
		}
		effect.tag &= ~HookHasEffect;
	});
}

// 对 Effect 环形链中的 Effect 实例对象执行 Destroy 逻辑
export function commitHookEffectListDestroy(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const destroy = effect.destroy;
		if (typeof destroy === 'function') {
			destroy();
		}
	});
}

// 对 Effect 环形链中的 Effect 实例对象执行 Create 逻辑
export function commitHookEffectListCreate(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const create = effect.create;
		if (typeof create === 'function') {
			effect.destroy = create();
		}
	});
}

function recordHostChildrenToDelete(
	childrenToDelete: FiberNode[],
	unmountFiber: FiberNode
) {
	// 1. 找到第一个 root host 节点
	// 获取 childToDelete 数组最后一个元素
	const lastOne = childrenToDelete[childrenToDelete.length - 1];

	if (!lastOne) {
		// 如果 lastOne 为 0，说明当前 childToDelete 数组为空
		childrenToDelete.push(unmountFiber);
	} else {
		// 获取当前 childToDelete 数组最右一个元素的 sibling
		let node = lastOne.sidling;
		// 循环找出 lastOne 关联的所有元素
		while (node !== null) {
			// 如果当前 node 变量所记录的 fiberNode 节点是否全等于传入的 unmountFiber 节点
			if (unmountFiber === node) {
				// 将传入的 unmountFiber 变量中的 fiberNode 丢进 childrenToDelete
				childrenToDelete.push(unmountFiber);
			}
			// 循环赋值 node 变量
			node = node.sidling;
		}
	}
	// 2. 没找到一个 host 节点，判断一下这个节点是不是第 1 找到那个节点的兄弟节点
}

// 提交 Delete 操作函数逻辑
function commitDeletion(childToDelete: FiberNode, root: FiberRootNode) {
	// 定义变量记录被删除的 DOM 的根节点
	const rootChildrenToDelete: FiberNode[] = [];

	// 递归子树操作
	commitNestedComponent(childToDelete, (unmountFiber) => {
		switch (unmountFiber.tag) {
			case HostComponent:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				// TODO 解绑 ref
				return;

			case HostText:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				return;

			case FunctionComponent:
				// TODO 解绑 ref
				commitPassiveEffect(unmountFiber, root, 'unmount');
				return;

			default:
				if (__DEV__) {
					console.warn('未处理的 unmount 类型: ', unmountFiber);
				}
		}
	});

	// 移除 rootHostComponent 的 DOM
	if (rootChildrenToDelete.length) {
		// 获取需要被删除的 DOM 节点的父节点
		const hostParent = getHostParent(childToDelete);
		if (hostParent !== null) {
			// 调用 removeChild 函数删除 hostParent 下的 rootHostNode 子节点
			rootChildrenToDelete.forEach((node) => {
				removeChild(node.stateNode, hostParent);
			});
		}
	}
	// 置空对应的 fiberNode 对应的属性，因为 childToDelete 对应的 DOM 已经被删除了
	childToDelete.return = null;
	childToDelete.child = null;
}

// 递归遍历需要被删除的 root 下的 child，并执行传入的 onCommitUnmount
// onCommitUnmount 箭头函数的目的：为了能够为 root 下的各个 child 执行对应的删除前操作
function commitNestedComponent(
	root: FiberNode,
	onCommitUnmount: (fiber: FiberNode) => void
) {
	let node = root;

	while (true) {
		// 执行传入的 onCommitUnmount 函数，目的：为了能够为 root 下的各个 child 执行相应的删除前操作
		onCommitUnmount(node);

		// 向下遍历的过程
		if (node.child !== null) {
			node.child.return = node;
			node = node.child;
			continue;
		}
		if (node === root) {
			// 终止条件
			return;
		}
		// 处理兄弟节点
		while (node.sidling === null) {
			if (node.return === null || node.return === root) {
				return;
			}
			// 向上归的过程
			node = node.return;
		}
		// 完善 node.sibling.return 属性
		node.sidling.return = node.return;
		// 循环赋值 node 变量
		node = node.sidling;
	}
}

// 操作 Placement 对应的动作
const commitPlacement = (finishedWork: FiberNode) => {
	// finishedWork ~ DOM
	if (__DEV__) {
		console.warn('执行Placement操作', finishedWork);
	}
	// parent DOM
	const hostParent = getHostParent(finishedWork);

	// 为了实现 parentNode.insertBefore 需要找到「目标兄弟 Host 节点」
	const sibling = getHostSibling(finishedWork);

	// 找到 finished 对应的 DOM，并将其 append 到 hostParent 中
	if (hostParent !== null) {
		insertOrAppendPlacementNodeIntoContainer(finishedWork, hostParent, sibling);
	}
};

// 获取目标节点最近的、可用的兄弟节点的有效 DOM
function getHostSibling(fiber: FiberNode) {
	// 将目标节点赋值给 node 变量
	let node: FiberNode = fiber;

	// 定义了一个查找目标节点最近的、可用的兄弟节点的有效 DOM 循环
	findSibling: while (true) {
		// 如果该节点没有兄弟节点，则回溯向上一级，查找父节点的兄弟节点
		while (node.sidling === null) {
			// 将 node 的父节点赋值给 parent 变量
			const parent = node.return;

			// 终止条件
			if (
				parent === null ||
				parent.tag === HostComponent ||
				parent.tag === HostRoot
			) {
				return null;
			}
			// 循环赋值 node 变量
			node = parent;
		}
		// 补充 node.sibling.return 属性
		node.sidling.return = node.return;
		// 循环赋值 node 变量
		node = node.sidling;

		// 当该 fiberNode 并不是有效的 DOM，则向下寻找下一级的有效 DOM
		while (node.tag !== HostText && node.tag !== HostComponent) {
			// 向下遍历，寻找子孙节点
			if ((node.flags & Placement) !== NoFlags) {
				// 代表该兄弟节点是不稳定的，所以继续寻找下一个兄弟节点
				continue findSibling;
			}

			if (node.child === null) {
				// 如果遍历到底了，那么向上一级，从父节点的兄弟节点下手继续往下找
				continue findSibling;
			} else {
				// 如果还没有到底，则继续往下寻找
				node.child.return = node;
				// 循环赋值变量 node
				node = node.child;
			}
		}

		if ((node.flags & Placement) === NoFlags) {
			// 相当于找到了目标的兄弟节点 DOM
			return node.stateNode;
		}
	}
}

// 获取当前 fiberNode 对应 DOM 的父 DOM 节点
function getHostParent(fiber: FiberNode): Container | null {
	let parent = fiber.return;

	// 不断向上找，直到找到 tag 为 HostComponent 或 HostRoot 类型的 fiberNode 对应的 DOM 节点
	while (parent) {
		const parentTag = parent.tag;
		// HostComponent HostRoot
		if (parentTag === HostComponent) {
			return parent.stateNode as Container;
		}
		if (parentTag === HostRoot) {
			return (parent.stateNode as FiberRootNode).container;
		}
		parent = parent.return;
	}

	if (__DEV__) {
		console.warn('未找到 host parent');
	}

	return null;
}

// 执行 Placement 对应的副作用，将对应的 fiberNode 的 DOM 挂载到其父 DOM 节点
function insertOrAppendPlacementNodeIntoContainer(
	finishedWork: FiberNode,
	hostParent: Container,
	before?: Instance
) {
	// 期望 fiberNode 的 tag 为 HostComponent 或者 HostText
	if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
		if (before) {
			insertChildToContainer(finishedWork.stateNode, hostParent, before);
		} else {
			appendChildToContainer(hostParent, finishedWork.stateNode);
		}

		return;
	}

	// 如果 finishedWork 变量的类型不为 HostComponent 或 HostText，则向下查找，直到找到类型为 HostComponent 或 HostText 的 fiberNode
	const child = finishedWork.child;
	// 往下查找 DOM
	if (child !== null) {
		insertOrAppendPlacementNodeIntoContainer(child, hostParent);
		// 将所有兄弟节点同样挂载到页面上
		let sibling = child.sidling;

		// 循环挂载所有的兄弟节点
		while (sibling !== null) {
			insertOrAppendPlacementNodeIntoContainer(sibling, hostParent);
			sibling = sibling.sidling;
		}
	}
}
