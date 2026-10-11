/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export default function Notch() {
  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 flex items-start select-none">
      {/* Left inward curve fillet (6px CAD radius) */}
      <svg
        width="6"
        height="6"
        viewBox="0 0 6 6"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="block shrink-0"
      >
        <path d="M0 0H6V6C6 2.68629 3.31371 0 0 0Z" fill="#000000" />
      </svg>

      {/* Main iPhone 11 Notch body: 209px wide × 30px tall, 20px bottom corner radius */}
      <div className="w-[209px] h-[30px] bg-black rounded-b-[20px]" />

      {/* Right inward curve fillet (6px CAD radius) */}
      <svg
        width="6"
        height="6"
        viewBox="0 0 6 6"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="block shrink-0"
      >
        <path d="M6 0H0V6C0 2.68629 2.68629 0 6 0Z" fill="#000000" />
      </svg>
    </div>
  );
}
