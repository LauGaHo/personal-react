import { Props, Key, Ref, ReactElementType } from 'shared/ReactTypes';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	OffscreenComponent,
	SuspenseComponent,
	WorkTag
} from './workTags';
import { Flags, NoFlags } from './fiberFlags';
import { Container } from 'hostConfig';
import { Lane, Lanes, NoLane, NoLanes } from './fiberLanes';
import { Effect } from './fiberHooks';
import { CallbackNode } from 'scheduler';
import { REACT_PROVIDER_TYPE, REACT_SUSPENSE_TYPE } from 'shared/ReactSymbols';

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
	ref: Ref;

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

	constructor(container: Container, hostRootFiber: FiberNode) {
		this.container = container;
		this.current = hostRootFiber;
		hostRootFiber.stateNode = this;
		this.finishedWork = null;
		this.pendingLanes = NoLanes;
		this.finishedLane = NoLane;

		this.callbackNode = null;
		this.callbackPriority = NoLane;

		this.pendingPassiveEffects = {
			unmount: [],
			update: []
		};
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
		typeof type === 'object' &&
		type.$$typeof === REACT_PROVIDER_TYPE
	) {
		fiberTag = ContextProvider;
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
