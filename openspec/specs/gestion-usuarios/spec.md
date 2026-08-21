# gestion-usuarios Specification

## Purpose
Da de alta a las personas que pueden entrar al inventario y permite cambiarles la contraseña o el rol desde la línea de comandos del servidor, sin exponer esa gestión en la web.

## Requirements

### Requirement: La gestión de usuarios vive fuera de la web
El sistema SHALL gestionar altas de usuarios y cambios de contraseña únicamente desde la línea de comandos del servidor. La aplicación web MUST NOT ofrecer registro ni alta de usuarios.

#### Scenario: No hay registro público
- **WHEN** alguien sin sesión busca una forma de darse de alta desde la web
- **THEN** no existe: la única pantalla accesible sin sesión es la de entrada

### Requirement: Preparación idempotente de la base
El sistema SHALL crear las tablas que falten cada vez que se prepara o se arranca la instalación, de forma que ejecutarlo repetidamente sobre una base ya montada no altere ni borre nada de lo que ya hay.

#### Scenario: Base recién creada
- **WHEN** se prepara la instalación sobre una base vacía
- **THEN** el sistema crea todas las tablas necesarias

#### Scenario: Base ya en uso
- **WHEN** se vuelve a preparar la instalación sobre una base que ya tiene datos
- **THEN** el sistema no altera las tablas existentes ni toca los datos guardados

### Requirement: Usuario inicial solo cuando no hay ninguno
Al preparar la instalación, el sistema SHALL crear un usuario inicial únicamente si no existe ningún usuario todavía, y MUST NOT tocar los usuarios existentes en preparaciones posteriores.

Tras crearlo, el sistema SHALL indicar cómo cambiarle la contraseña.

#### Scenario: Primera preparación
- **WHEN** se prepara la instalación y no hay ningún usuario
- **THEN** el sistema crea el usuario inicial y explica cómo cambiar su contraseña

#### Scenario: Preparación posterior
- **WHEN** se vuelve a preparar la instalación y ya existen usuarios
- **THEN** el sistema informa de cuántos hay y no modifica ninguno

### Requirement: Carga de productos de ejemplo sin pisar los reales
Al preparar la instalación, el sistema SHALL cargar los productos de la semilla inicial omitiendo los identificadores que ya existan, y SHALL informar de cuántos añadió y cuántos hay en total.

El sistema MUST tratar la semilla como carga inicial y no como fuente de verdad: el dato vivo es el de la base.

#### Scenario: Semilla sobre base vacía
- **WHEN** se prepara la instalación sin productos en la base
- **THEN** el sistema carga los productos de la semilla e informa de cuántos añadió

#### Scenario: Semilla sobre productos ya editados
- **WHEN** se vuelve a preparar la instalación y algunos identificadores de la semilla ya existen con datos editados a mano
- **THEN** el sistema conserva los datos editados y no los revierte a los de la semilla

#### Scenario: Sin archivo de semilla
- **WHEN** se prepara la instalación y no existe el archivo de semilla
- **THEN** el sistema continúa sin error y no carga ningún producto

### Requirement: Alta de un usuario
El sistema SHALL permitir dar de alta a una persona indicando su nombre, su usuario, su correo, su contraseña y opcionalmente su rol, tomando el rol de mayor permiso cuando no se indique.

El sistema MUST exigir los datos completos al crear a alguien nuevo y MUST rechazar el alta con un mensaje claro cuando falte alguno.

El usuario y el correo SHALL ser únicos sin distinguir mayúsculas, porque así es como se escriben al entrar.

#### Scenario: Alta completa
- **WHEN** se da de alta a una persona con nombre, usuario, correo y contraseña
- **THEN** el sistema la crea y confirma el alta

#### Scenario: Alta con rol de solo lectura
- **WHEN** se da de alta a una persona indicando el rol de solo lectura
- **THEN** el sistema la crea con ese rol y esa persona no podrá modificar el inventario

#### Scenario: Faltan datos para el alta
- **WHEN** se intenta crear a alguien nuevo sin nombre o sin correo
- **THEN** el sistema rechaza la operación indicando qué datos hacen falta

#### Scenario: Usuario o correo repetidos
- **WHEN** se intenta dar de alta un usuario o un correo que ya existe, aunque escrito con distinta caja
- **THEN** el sistema no crea un duplicado

### Requirement: Cambio de contraseña
El sistema SHALL permitir cambiar la contraseña de un usuario existente indicando solo su usuario y la contraseña nueva.

Cambiar la contraseña MUST cerrar todas las sesiones abiertas de esa persona, para que un cambio hecho porque la contraseña se filtró expulse de verdad a quien la tuviera.

#### Scenario: Cambio correcto
- **WHEN** se cambia la contraseña de un usuario existente
- **THEN** el sistema la actualiza y esa persona entra con la nueva

#### Scenario: Sesiones abiertas al cambiar
- **WHEN** se cambia la contraseña de un usuario que tenía sesiones abiertas en otros dispositivos
- **THEN** esas sesiones dejan de valer y esos dispositivos vuelven a pedir contraseña

#### Scenario: Falta la contraseña nueva
- **WHEN** se pide un cambio sin indicar la contraseña nueva
- **THEN** el sistema rechaza la operación indicando que falta

### Requirement: Las contraseñas nunca se guardan en claro
El sistema MUST guardar las contraseñas cifradas con una función de derivación lenta y con sal, diseñada para resistir ataques por fuerza bruta, y MUST NOT guardarlas ni registrarlas en claro en ningún momento.

#### Scenario: Contraseña guardada
- **WHEN** se da de alta a alguien o se le cambia la contraseña
- **THEN** en la base queda el resultado del cifrado, del que no se puede recuperar la contraseña original

#### Scenario: Dos personas con la misma contraseña
- **WHEN** dos usuarios distintos eligen la misma contraseña
- **THEN** lo guardado para cada uno es distinto, porque cada cifrado usa su propia sal
