import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';
import { isSubsetOfLanes, Lane, NoLane } from './fiberLanes';

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
): {
	memoizedState: State;
	baseState: State;
	baseQueue: Update<State> | null;
} => {
	const result: ReturnType<typeof processUpdateQueue<State>> = {
		memoizedState: baseState,
		baseState,
		baseQueue: null
	};

	if (pendingUpdate !== null) {
		// 获取到 updateQueue.shared.pending 中的 Update 链表中第一个插入的 Update 对象
		const first = pendingUpdate.next;
		// do~while 循环中使用的变量
		let pending = pendingUpdate.next as Update<any>;

		// 将 newBaseState 初始化为 baseState 值
		let newBaseState = baseState;
		// 声明指向 newBaseQueue 中的第一个和最后一个 update 实例对象的指针变量
		let newBaseQueueFirst: Update<State> | null = null;
		let newBaseQueueLast: Update<State> | null = null;
		// 同样的将 newState 初始化为 baseState 值
		let newState = baseState;

		// 循环 pendingUpdate 链表求值
		do {
			// 获取当前 Update 对象对应的优先级 lane
			const updateLane = pending.lane;
			// 当前 Update 对象对应的优先级 lane 全等于当前任务的优先级，则执行
			if (!isSubsetOfLanes(renderLane, updateLane)) {
				// 优先级不够，被跳过
				// clone 为被跳过的 update 实例对象，克隆了一份出来
				const clone = createUpdate(pending.action, pending.lane);
				// 判断当前跳过的 update 是否为第一个被跳过的 update
				if (newBaseQueueFirst === null) {
					// 说明当前跳过的 update 是第一个被跳过的 update
					newBaseQueueFirst = clone;
					newBaseQueueLast = clone;
					// 由于发现了第一个跳过的 update，所以此时需要将 baseState 固定下来，所以需要为 newBaseState 赋值
					newBaseState = newState;
				} else {
					// 说明当前跳过的 update 并不是第一个被跳过
					(newBaseQueueLast as Update<State>).next = clone;
					newBaseQueueLast = clone;
				}
			} else {
				// 优先级足够
				if (newBaseQueueLast !== null) {
					// 就算优先级足够，但是由于前边已经存在跳过的 update 对象，所以此时需要将之后的所有 update 变成 NoLane，并放进 baseQueue
					const clone = createUpdate(pending.action, NoLane);
					newBaseQueueLast.next = clone;
					newBaseQueueLast = clone;
				}

				// 获取 update 实例对象中的 action 属性
				const action = pending.action;
				if (action instanceof Function) {
					// baseState = 1; update = (x) => 4x; => memoizedState = 4
					newState = action(baseState);
				} else {
					// baseState = 1; update = 2; => memoizedState = 2
					newState = action;
				}
			}
			// 循环赋值变量 pending
			pending = pending.next as Update<any>;
		} while (pending !== first);

		if (newBaseQueueLast === null) {
			// 代表本次计算没有 update 对象被跳过
			// baseState === memoizedState 在这里等价于 newBaseState === newState
			newBaseState = newState;
		} else {
			// 本次计算有 update 实例对象被跳过
			// 需要形成一条循环链表
			newBaseQueueLast.next = newBaseQueueFirst;
		}
		// 将对应的值给 result 赋上
		result.memoizedState = newState;
		result.baseState = newBaseState;
		result.baseQueue = newBaseQueueLast;
	}

	return result;
};
