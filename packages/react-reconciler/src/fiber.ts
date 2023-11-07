import { Props, Key, Ref, ReactElementType, Wakeable } from 'shared/ReactTypes';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	MemoComponent,
	OffscreenComponent,
	SuspenseComponent,
	WorkTag
} from './workTags';
import { Flags, NoFlags } from './fiberFlags';
import { Container } from 'hostConfig';
import { Lane, Lanes, NoLane, NoLanes } from './fiberLanes';
import { Effect } from './fiberHooks';
import { CallbackNode } from 'scheduler';
import {
	REACT_MEMO_TYPE,
	REACT_PROVIDER_TYPE,
	REACT_SUSPENSE_TYPE
} from 'shared/ReactSymbols';

export interface OffscreentProps {
	mode: 'visible' | 'hidden';
	children: any;
}

export class FiberNode {
	type: any;
	tag: WorkTag;
	pendingProps: Props;
	key: Key;
	stateNode: any;
	ref: Ref | null;

	return: FiberNode | null;
	sidling: FiberNode | null;
	child: FiberNode | null;
	index: number;

	memoizedProps: Props | null;
	// 对于 FunctionComponent 来说，存放着 Hook 链表
	memoizedState: any;
	alternate: FiberNode | null;
	flags: Flags;
	subtreeFlags: Flags;
	// 对于 FunctionComponent 来说，存放着 FCUpdateQueue，FCUpdateQueue 中存放着 Effect 环状链表
	updateQueue: unknown;
	// 存放需要被删除的 FiberNode 子节点
	deletions: FiberNode[] | null;
	// 存放当前 FiberNode 节点存在哪些优先级的 Update 未执行
	lanes: Lanes;
	// 存放当前 FiberNode 节点的子树存在哪些优先级的 Update 未执行
	childLanes: Lanes;

	constructor(tag: WorkTag, pendingProps: Props, key: Key) {
		this.tag = tag;
		this.key = key || null;
		// 对于 HostComponent <div> 该属性就保留了 div DOM
		this.stateNode = null;
		// 对于 FunctionComponent 来说，是一个函数：() => {}
		this.type = null;

		// 构成树状结构
		this.return = null;
		this.sidling = null;
		this.child = null;
		this.index = 0;

		this.ref = null;

		// 作为工作单元
		this.pendingProps = pendingProps;
		this.memoizedProps = null;
		this.memoizedState = null;
		this.updateQueue = null;

		this.alternate = null;
		// 副作用
		this.flags = NoFlags;
		this.subtreeFlags = NoFlags;
		this.deletions = null;

		this.lanes = NoLanes;
		this.childLanes = NoLanes;
	}
}

export interface PendingPassiveEffects {
	unmount: Effect[];
	update: Effect[];
}

export class FiberRootNode {
	container: Container;
	current: FiberNode;
	finishedWork: FiberNode | null;
	// 未被消费的 Lane 集合
	pendingLanes: Lanes;
	// 本次更新消费的 Lane
	finishedLane: Lane;
	pendingPassiveEffects: PendingPassiveEffects;

	// 当前正在被 scheduler 调度的任务
	callbackNode: CallbackNode | null;
	// 当前正在被 scheduler 调度的任务的优先级
	callbackPriority: Lane;

	// WeakMap { promise: Set<Lane> }
	pingCache: WeakMap<Wakeable<any>, Set<Lane>> | null;

	// 如果某一次更新被挂起了，那么本次更新对应的 Lane 就会被加入到 suspendedLanes 集合中，过一段时间后，如果对应的 Wakeable 被唤醒了，则对应的 Lane 也会被加入到 pingLanes 变量中
	// 所以 pingLanes 中的所有 Lane 都是 suspendedLanes 的子集
	// 表示所有被挂起更新对应的优先级 Lane 的集合
	suspendedLanes: Lanes;
	// 表示所有已经执行了 ping 方法对应的优先级 Lane 集合
	pingLanes: Lane;

	constructor(container: Container, hostRootFiber: FiberNode) {
		this.container = container;
		this.current = hostRootFiber;
		hostRootFiber.stateNode = this;
		this.finishedWork = null;
		this.pendingLanes = NoLanes;
		this.finishedLane = NoLane;
		this.suspendedLanes = NoLanes;
		this.pingLanes = NoLanes;

		this.callbackNode = null;
		this.callbackPriority = NoLane;

		this.pendingPassiveEffects = {
			unmount: [],
			update: []
		};

		this.pingCache = null;
	}
}

/**
 * 根据 current 创建 workInProgress
 * @param current {FiberNode} 当前页面上的 DOM 对应的 FiberNode
 * @param pendingProps {Props} 本次更新的 props
 */
export const createWorkInProgress = (
	current: FiberNode,
	pendingProps: Props
): FiberNode => {
	let wip = current.alternate;

	if (wip === null) {
		// mount 阶段
		wip = new FiberNode(current.tag, pendingProps, current.key);
		wip.stateNode = current.stateNode;

		wip.alternate = current;
		current.alternate = wip;
	} else {
		// update 阶段
		wip.pendingProps = pendingProps;
		wip.flags = NoFlags;
		wip.subtreeFlags = NoFlags;
		wip.deletions = null;
	}
	wip.type = current.type;
	wip.updateQueue = current.updateQueue;
	wip.child = current.child;
	wip.memoizedProps = current.memoizedProps;
	wip.memoizedState = current.memoizedState;
	wip.ref = current.ref;

	wip.lanes = current.lanes;
	wip.childLanes = current.childLanes;

	return wip;
};

/**
 * 根据 ReactElement 创建 FiberNode
 * @param element {ReactElementType} jsx 函数返回的 ReactElement
 */
export function createFiberFromElement(element: ReactElementType): FiberNode {
	const { type, key, props, ref } = element;
	// 默认赋值为 FunctionComponent 类型
	let fiberTag: WorkTag = FunctionComponent;

	if (typeof type === 'string') {
		// 对于 <div/> 它的 type 就为 'div'
		fiberTag = HostComponent;
	} else if (
		// 对于 <ctx.Provider/> 它的 type 就为 { $$typeof: Symbol(react.provider) }
		// 对于 React.memo() 它的 type 为 { $$typeof: Symbol(react.memo), ... }
		typeof type === 'object'
	) {
		// 通过 $$typeof 来判断是 Provider 还是 Memo
		switch (type.$$typeof) {
			case REACT_PROVIDER_TYPE:
				fiberTag = ContextProvider;
				break;

			case REACT_MEMO_TYPE:
				fiberTag = MemoComponent;
				break;

			default:
				console.warn('未定义的 type 类型', element);
				break;
		}
	} else if (type === REACT_SUSPENSE_TYPE) {
		fiberTag = SuspenseComponent;
	} else if (typeof type !== 'function' && __DEV__) {
		console.warn('未定义的type类型', element);
	}

	const fiber = new FiberNode(fiberTag, props, key);
	fiber.type = type;
	fiber.ref = ref;

	return fiber;
}

/**
 * 根据 Fragment 创建对应的 FiberNode
 * @param elements {any[]} Fragment 的 children
 * @param key {Key} Fragment 的 key
 */
export function createFiberFromFragment(elements: any[], key: Key): FiberNode {
	const fiber = new FiberNode(Fragment, elements, key);
	return fiber;
}

export function createFiberFromOffscreen(pendingProps: OffscreentProps) {
	const fiber = new FiberNode(OffscreenComponent, pendingProps, null);
	return fiber;
}
