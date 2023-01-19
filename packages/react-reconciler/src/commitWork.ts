import {
	appendChildToContainer,
	commitUpdate,
	Container,
	removeChild
} from 'hostConfig';
import { FiberNode, FiberRootNode } from './fiber';
import {
	ChildDeletion,
	MutationMask,
	NoFlags,
	Placement,
	Update
} from './fiberFlags';
import {
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';

let nextEffect: FiberNode | null = null;

// 某个 fiberNode 节点的 subtreeFlags 或 flags 不为 NoFlags 就会进来该函数通过遍历，查找对应的节点，并执行对应的副作用
export const commitMutationEffects = (finishedWork: FiberNode) => {
	nextEffect = finishedWork;

	// 总的遍历方式：一直往下遍历，直到 subtreeFlags 为 NoFlags；其次从其 sibling 出发；最后向上进行归操作
	while (nextEffect !== null) {
		// 向下遍历
		const child: FiberNode | null = nextEffect.child;

		if (
			(nextEffect.subtreeFlags & MutationMask) !== NoFlags &&
			child !== null
		) {
			// 节点的 subtreeFlags 不为 NoFlags
			nextEffect = child;
		} else {
			// 节点的 subtreeFlags 为空 && (节点的 flags 不为 NoFlags 或为 NoFlags)
			up: while (nextEffect !== null) {
				commitMutationEffectsOnFiber(nextEffect);
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
const commitMutationEffectsOnFiber = (finishedWork: FiberNode) => {
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
				commitDeletion(childToDelete);
			});
		}
		finishedWork.flags &= ~ChildDeletion;
	}
};

// 提交 Delete 操作函数逻辑
function commitDeletion(childToDelete: FiberNode) {
	// 定义变量记录被删除的 DOM 的根节点
	let rootHostNode: FiberNode | null = null;

	// 递归子树操作
	commitNestedComponent(childToDelete, (unmountFiber) => {
		switch (unmountFiber.tag) {
			case HostComponent:
				if (rootHostNode === null) {
					rootHostNode = unmountFiber;
				}
				// TODO 解绑 ref
				return;

			case HostText:
				if (rootHostNode === null) {
					rootHostNode = unmountFiber;
				}
				return;

			case FunctionComponent:
				// TODO useEffect unmount
				return;

			default:
				if (__DEV__) {
					console.warn('未处理的 unmount 类型: ', unmountFiber);
				}
		}
	});

	// 移除 rootHostComponent 的 DOM
	if (rootHostNode !== null) {
		// 获取需要被删除的 DOM 节点的父节点
		const hostParent = getHostParent(rootHostNode);
		if (hostParent !== null) {
			// 调用 removeChild 函数删除 hostParent 下的 rootHostNode 子节点
			removeChild(rootHostNode, hostParent);
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
		node.sidling.return = node.return;
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
	// 找到 finished 对应的 DOM，并将其 append 到 hostParent 中
	if (hostParent !== null) {
		appendPlacementNodeIntoContainer(finishedWork, hostParent);
	}
};

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
function appendPlacementNodeIntoContainer(
	finishedWork: FiberNode,
	hostParent: Container
) {
	// 期望 fiberNode 的 tag 为 HostComponent 或者 HostText
	if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
		appendChildToContainer(hostParent, finishedWork.stateNode);
		return;
	}

	const child = finishedWork.child;
	if (child !== null) {
		appendPlacementNodeIntoContainer(child, hostParent);
		let sibling = child.sidling;

		while (sibling !== null) {
			appendPlacementNodeIntoContainer(sibling, hostParent);
			sibling = sibling.sidling;
		}
	}
}
