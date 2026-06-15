import { forwardRef } from "react";

const VARIANT_CLASS = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  ghost: "btn-ghost",
};

const SIZE_CLASS = {
  sm: "btn-size-sm",
  md: "btn-size-md",
  lg: "btn-size-lg",
};

const SIZE_MIN_WIDTH = {
  sm: undefined,
  md: 160,
  lg: 220,
};

const FantasyButton = forwardRef(function FantasyButton(
  {
    variant = "primary",
    size = "md",
    icon,
    iconRight,
    children,
    onClick,
    disabled = false,
    type = "button",
    className = "",
    style,
    withSheen = true,
    ariaLabel,
    ...rest
  },
  ref
) {
  const variantClass = VARIANT_CLASS[variant] ?? VARIANT_CLASS.primary;
  const sizeClass = SIZE_CLASS[size] ?? SIZE_CLASS.md;
  const minWidth = SIZE_MIN_WIDTH[size];
  const sheenTint =
    variant === "primary"
      ? "via-gold/30"
      : variant === "danger"
        ? "via-[rgba(231,29,54,0.18)]"
        : "via-parchment/10";

  const inlineStyle = {
    fontFamily: "var(--font-title)",
    ...(minWidth ? { minWidth: `${minWidth}px` } : {}),
    ...style,
  };

  return (
    <button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`btn-base ${variantClass} ${sizeClass} group ${className}`}
      style={inlineStyle}
      {...rest}
    >
      {withSheen && (
        <span
          aria-hidden="true"
          className={`btn-sheen bg-gradient-to-r from-transparent ${sheenTint} to-transparent`}
        />
      )}
      {icon && (
        <span aria-hidden="true" className="relative inline-flex shrink-0">
          {icon}
        </span>
      )}
      <span className="relative inline-flex items-center">{children}</span>
      {iconRight && (
        <span aria-hidden="true" className="relative inline-flex shrink-0">
          {iconRight}
        </span>
      )}
    </button>
  );
});

export default FantasyButton;
