import { ReactElementType } from 'shared/ReactTypes';
// @ts-ignore
import { createRoot } from 'react-dom';

/**
 * 测试方法，将 element 渲染到 document 中
 * @param element {ReactElementType} 被渲染的目标元素
 */
export function renderIntoDocument(element: ReactElementType) {
	const div = document.createElement('div');
	// 返回值需要为 ReactElement 类型
	return createRoot(div).render(element);
}
