import { ReactContext } from 'shared/ReactTypes';

// 定义一个 value 栈
const valueStack: any[] = [];

/**
 * render 阶段中 '递' 的过程中，会将 Context.Provider 的 value 值 push 到 valueStack 中
 * @param context {ReactContext<T>} Context 实例对象
 * @param newValue {T} Context.Provider 的 value 值
 * @template T
 */
export function pushProvider<T>(context: ReactContext<T>, newValue: T) {
	valueStack.push(newValue);
	context._currentValue = newValue;
}

/**
 * render 阶段中 '归' 的过程中，会将 valueStack 中最新的 value pop 出来
 * @param context {ReactContext<T>} Context 实例对象
 * @template T
 */
export function popProvider<T>(context: ReactContext<T>) {
	// 从栈中 pop 出最新的 value
	const currentValue = valueStack[valueStack.length - 1];
	// 将最新的 value 赋值到 context._currentValue 属性中
	context._currentValue = currentValue;
	// 将最新的 value 从栈中 pop 弹出
	valueStack.pop();
}
