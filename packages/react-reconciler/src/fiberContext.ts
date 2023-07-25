import { ReactContext } from 'shared/ReactTypes';

// 記錄上一個 Context 的 value 值
let prevContextValue: any = null;
// 定义一个 value 栈
const prevContextValueStack: any[] = [];

/**
 * render 阶段中 '递' 的过程中，会将 Context.Provider 的 value 值 push 到 valueStack 中
 * @param context {ReactContext<T>} Context 实例对象
 * @param newValue {T} Context.Provider 的 value 值
 * @template T
 */
export function pushProvider<T>(context: ReactContext<T>, newValue: T) {
	// 將上一個 context 的 value 值 push 到 prevContextValueStack 中
	prevContextValueStack.push(prevContextValue);
	// 將當前 context 的 value 值賦值給 preContextValue 變量
	prevContextValue = context._currentValue;
	// 將 context._currentValue 更新為 newValue
	context._currentValue = newValue;
}

/**
 * render 阶段中 '归' 的过程中，会将 valueStack 中最新的 value pop 出来
 * @param context {ReactContext<T>} Context 实例对象
 * @template T
 */
export function popProvider<T>(context: ReactContext<T>) {
	// 將上一個 context 的 value 賦值到當前 context 中的 _currentValue 變量中
	context._currentValue = prevContextValue;
	// 将最新的 value 从栈中 pop 弹出，並賦值為 prevContextValue 變量
	prevContextValue = prevContextValueStack.pop();
}
