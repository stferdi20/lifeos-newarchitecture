import React, { useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

export default function AnimatedNumber({
  value,
  duration = 1000, // milliseconds
  className = '',
  formatFn = (val) => Math.floor(val).toString(),
}) {
  const [hasAnimated, setHasAnimated] = useState(false);
  const springValue = useSpring(0, {
    stiffness: 50,
    damping: 20,
    restDelta: 0.001,
  });

  const displayValue = useTransform(springValue, (current) => formatFn(current));

  useEffect(() => {
    springValue.set(value);
    setHasAnimated(true);
  }, [value, springValue]);

  return <motion.span className={className}>{displayValue}</motion.span>;
}
