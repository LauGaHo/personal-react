export type Type = any;
export type Key = any;
export type Ref = { current: any } | ((instance: any) => void);
export type Props = any;
export type ElementType = any;

export interface ReactElementType {
	$$typeof: symbol | number;
	type: ElementType;
	key: Key;
	props: Props;
	ref: Ref;
	__mark: string;
}

export type Action<State> = State | ((prevState: State) => State);

export type ReactProviderType<T> = {
	$$typeof: symbol | number;
	_context: ReactContext<T> | null;
};

export type ReactContext<T> = {
	$$typeof: symbol | number;
	Provider: ReactProviderType<T> | null;
	_currentValue: T;
};

export type Usable<T> = Thenable<T> | ReactContext<T>;

// Wakeable 和 Thenable 的区别在于：Wakeable 的 then 是负责启动页面的重新 render，Thenable 只是将请求的 value 赋值到对应的 value 字段上
export interface Wakeable<Result> {
	then(
		onFulfiled: () => Result,
		onRejected: () => Result
	): void | Wakeable<Result>;
}

export interface ThenableImpl<T, Result, Err> {
	then(
		onFulfiled: (value: T) => Result,
		onRejected: (error: Err) => Result
	): void | Wakeable<Result>;
}

export interface UntrackedThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status?: void;
}

export interface PendingThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status: 'pending';
}

export interface FulfilledThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status: 'fulfilled';
	value: T;
}

export interface RejectedThenable<T, Result, Err>
	extends ThenableImpl<T, Result, Err> {
	status: 'rejected';
	reason: Err;
}

// 未追踪状态：untracked
// 等待状态：pending
// 对应 Promise 的 resolved 状态：fulfilled
// 对应 Promise 的 rejected 状态：rejected
// 用户传入一个 Promise 类型，我们内部将其处理为 Thenable 类型，最初传进来的 Promise 是一个未追踪 untracked 状态
export type Thenable<T, Result = void, Err = any> =
	| UntrackedThenable<T, Result, Err>
	| PendingThenable<T, Result, Err>
	| FulfilledThenable<T, Result, Err>
	| RejectedThenable<T, Result, Err>;
