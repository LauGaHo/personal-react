import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';
import { Lane } from './fiberLanes';

// 定义 Update
export interface Update<State> {
	action: Action<State>;
	lane: Lane;
	next: Update<any> | null;
}

// 定义 UpdateQueue
export interface UpdateQueue<State> {
	shared: {
		pending: Update<State> | null;
	};
	dispatch: Dispatch<State> | null;
}

// 创建 Update 对象
export const createUpdate = <State>(
	action: Action<State>,
	lane: Lane
): Update<State> => {
	return {
		action,
		lane,
		next: null
	};
};

// 创建 UpdateQueue
export const createUpdateQueue = <State>() => {
	return {
		shared: {
			pending: null
		},
		dispatch: null
	} as UpdateQueue<State>;
};

// 将 Update 实例对象放进 updateQueue 中
export const enqueueUpdate = <State>(
	updateQueue: UpdateQueue<State>,
	update: Update<State>
) => {
	const pending = updateQueue.shared.pending;
	if (pending === null) {
		// 如果当前 pending 为空，说明当前的 updateQueue 为空，所以将传进来的 update 对象的 next 指针指向它自己
		// pending -> a -> a
		// pending 指向的是这个链表最新插入的 update
		update.next = update;
	} else {
		// pending = b -> a -> b
		// pending = c -> a -> b -> c
		// 所以由上可知，pending 指向最新插入的 update，pending.next 指向第一个插入的 update
		update.next = pending.next;
		pending.next = update;
	}
	updateQueue.shared.pending = update;
};

// 实现 baseState 和 Update 对象进行比对，得出最新的 memoizedState
export const processUpdateQueue = <State>(
	baseState: State,
	pendingUpdate: Update<State> | null,
	renderLane: Lane
): { memoizedState: State } => {
	const result: ReturnType<typeof processUpdateQueue<State>> = {
		memoizedState: baseState
	};

	if (pendingUpdate !== null) {
		// 获取到 updateQueue.shared.pending 中的 Update 链表中第一个插入的 Update 对象
		const first = pendingUpdate.next;
		// do~while 循环中使用的变量
		let pending = pendingUpdate.next as Update<any>;
		do {
			// 获取当前 Update 对象对应的优先级 lane
			const updateLane = pending.lane;
			// 当前 Update 对象对应的优先级 lane 全等于当前任务的优先级，则执行
			if (updateLane === renderLane) {
				const action = pending.action;
				if (action instanceof Function) {
					// baseState = 1; update = (x) => 4x; => memoizedState = 4
					baseState = action(baseState);
				} else {
					// baseState = 1; update = 2; => memoizedState = 2
					baseState = action;
				}
			} else {
				if (__DEV__) {
					console.error('不应该进入 updateLane !== renderLane 这个逻辑');
				}
			}
			// 循环赋值变量 pending
			pending = pending.next as Update<any>;
		} while (pending !== first);
	}
	// 将最终的 baseState 赋值给 result.memoizedState
	result.memoizedState = baseState;
	return result;
};
